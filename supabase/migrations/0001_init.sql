-- ============================================================================
-- Chaldduk Web v1.0 — core schema (Build Spec v1 § 12.4)
-- Single-Postgres axis: Provenance · Card · Memory · Embedding share one
-- transaction boundary. Runs on Supabase Postgres or any Postgres + pgvector
-- (R-31 escape hatch); guarded blocks skip Supabase-only objects elsewhere.
-- ============================================================================

create extension if not exists vector;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

-- § 15 #3 — Card type enum (Mason 6/9, domain decision)
create type card_type as enum (
  'mark_relevant', 'mark_not_relevant', 'counterexample', 'caveat',
  'outcome_ping', 'provenance_attach', 'full_post'
);

-- § 15 #4 — Pair Type catalog: 3 base + BYOA (open ecosystem)
create type pair_type as enum (
  'claudi_base', 'chatgpt_base', 'cursor_base', 'custom_byoa'
);

create type signal_strength as enum ('strong', 'weak');         -- § 3.3
create type member_kind     as enum ('pair', 'agent');          -- § 8.2
create type activity_kind   as enum ('seek', 'store', 'signal', 'react', 'perform'); -- § 3.1
create type store_path      as enum ('seek_chain', 'independent');                   -- § 9.1
create type boundary_dir    as enum ('input', 'output');        -- § 1.2
create type memory_kind     as enum ('episodic', 'semantic');   -- § 5 (a)

-- ----------------------------------------------------------------------------
-- § 8 Pair Identity Model — Type anchor + Instance uniqueness
-- ----------------------------------------------------------------------------

create table pairs (
  pair_id        uuid primary key default gen_random_uuid(),
  pair_type      pair_type not null,                 -- Type anchor (catalog)
  instance_name  text not null check (length(trim(instance_name)) > 0),
  human_label    text,                               -- owner display name
  email          text,
  auth_user_id   uuid,                               -- Supabase Auth link (set on cloud deploy)
  api_key_hash   text not null unique,               -- § 10.1 step 3: manual API key path
  permissions    jsonb not null default '{"store": true, "signal": true, "react": true, "perform": true}',
  context_envelope jsonb,                            -- latest input-boundary handshake cache
  created_at     timestamptz not null default now(),
  unique (pair_type, instance_name)                  -- Instance uniqueness within Type
);

-- § 9.4 non-member = "informal pair": agent declares Type only, no Instance
create table agents (
  agent_id         uuid primary key default gen_random_uuid(),
  declared_type    pair_type not null,
  api_key_hash     text unique,                      -- anonymous-ish continuity token (quota + promotion)
  promoted_to_pair uuid references pairs(pair_id),   -- § 8.3 natural promotion target
  promoted_at      timestamptz,
  created_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- § 5 (b) Provenance chain — origin → derivations → verifications
-- ----------------------------------------------------------------------------

create table provenance_chains (
  provenance_id uuid primary key default gen_random_uuid(),
  origin        jsonb not null,                      -- {kind, ref|url|description, declared_by}
  derivations   jsonb not null default '[]',         -- [{from, note, at}]
  verifications jsonb not null default '[]',         -- [{verifier, at, delta}]
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- § 3 Cluster A — activity log (Realtime source for Step 3 narrative)
-- ----------------------------------------------------------------------------

create table activities (
  activity_id      uuid primary key default gen_random_uuid(),
  activity_type    activity_kind not null,
  attribution_kind member_kind not null,
  pair_id          uuid references pairs(pair_id),
  agent_id         uuid references agents(agent_id),
  session_id       uuid,                             -- groups a pair session (narrative unit)
  card_id          uuid,                             -- FK added after cards exists
  payload          jsonb not null default '{}',
  narrative        text not null,                    -- human-facing one-liner (timeline row, § 15.3)
  is_public        boolean not null default true,    -- Perform/public trail visibility (α observer)
  created_at       timestamptz not null default now(),
  check (
    (attribution_kind = 'pair'  and pair_id is not null) or
    (attribution_kind = 'agent' and agent_id is not null and pair_id is null)
  )
);

-- ----------------------------------------------------------------------------
-- § 7 Card — front (surface) + back (interior) in one row; surface exposed
-- only through the card_fronts view. § 15.1 type extensions in front_extension.
-- ----------------------------------------------------------------------------

create table cards (
  card_id          uuid primary key default gen_random_uuid(),

  -- ── front (surface, § 7.1) ────────────────────────────────────────────────
  type             card_type not null,
  attribution_kind member_kind not null,
  pair_id          uuid references pairs(pair_id),
  agent_id         uuid references agents(agent_id),
  signal_strength  signal_strength not null,
  signal_count     int not null default 0,
  summary          text not null check (length(trim(summary)) > 0),
  provenance_id    uuid not null references provenance_chains(provenance_id), -- invariant: card → provenance
  created_at       timestamptz not null default now(),
  pair_context_fingerprint text not null,            -- § 3.2 pair-context-as-query
  front_extension  jsonb not null default '{}',      -- § 15.1 per-type surface fields
  target_card_id   uuid references cards(card_id),   -- graph edge for mark_*/counterexample/caveat

  -- ── back (interior, § 7.2) ────────────────────────────────────────────────
  full_content     text not null check (length(trim(full_content)) > 0),
  reasoning_log    text not null,
  memory_link      uuid[] not null default '{}',     -- episodic memory entries this derives from
  verify_log       jsonb not null default '[]',
  surface_interior_check jsonb,                      -- last checker result (§ 6.3)

  -- ── bookkeeping ───────────────────────────────────────────────────────────
  store_path       store_path not null default 'independent', -- § 9.1 path A vs C (quota class)
  source_activity_id uuid references activities(activity_id), -- the Store activity that closed the cycle

  check (
    (attribution_kind = 'pair'  and pair_id is not null) or
    (attribution_kind = 'agent' and agent_id is not null and pair_id is null)
  ),
  -- § 6.1 principle 1: surface is a quantity-of-data slice of interior
  check (length(summary) <= length(full_content) + 200),
  -- types that point at another card must carry the edge
  check (
    type not in ('mark_relevant','mark_not_relevant','counterexample','caveat')
    or target_card_id is not null
  )
);

alter table activities
  add constraint activities_card_fk
  foreign key (card_id) references cards(card_id) deferrable initially deferred;

-- § 15.1 front extension validation (per-type required surface fields)
create or replace function validate_front_extension(p_type card_type, p_ext jsonb)
returns boolean language plpgsql immutable as $$
begin
  case p_type
    when 'mark_relevant', 'mark_not_relevant' then
      return (p_ext ? 'target_card_id') and (p_ext ? 'relevance_score')
        and (p_ext->>'relevance_score')::numeric between 1 and 5;
    when 'counterexample' then
      return (p_ext ? 'target_card_id') and length(coalesce(p_ext->>'counterexample_summary','')) > 0;
    when 'caveat' then
      return (p_ext ? 'target_card_id') and length(coalesce(p_ext->>'caveat_scope','')) > 0;
    when 'outcome_ping' then
      return (p_ext->>'outcome_status') in ('success','partial','failure');
    when 'provenance_attach' then
      return length(coalesce(p_ext->>'source_url','')) > 0
        and (p_ext->>'source_type') in ('paper','blog','repo','doc','other');
    when 'full_post' then
      return length(coalesce(p_ext->>'title','')) > 0
        and length(coalesce(p_ext->>'body_summary','')) > 0;
  end case;
  return false;
end $$;

alter table cards
  add constraint cards_front_extension_valid
  check (validate_front_extension(type, front_extension));

-- ----------------------------------------------------------------------------
-- § 5 (d) Embedding — every card gets one on register (deferred invariant)
-- ----------------------------------------------------------------------------

create table embeddings (
  card_id     uuid primary key references cards(card_id) on delete cascade,
  embedding   vector(1536) not null,                 -- § 15 #9: text-embedding-3-small / 1536-dim
  model       text not null,                         -- 'text-embedding-3-small' | 'local-dev-hash'
  pair_context_fingerprint text not null,
  created_at  timestamptz not null default now()
);

-- invariant: every Card MUST have an embeddings row computed on register.
-- Deferred constraint trigger: checked at transaction commit so card +
-- embedding insert in one tx (single-Postgres axis is exactly for this).
create or replace function assert_card_has_embedding()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from embeddings where card_id = new.card_id) then
    raise exception 'invariant violation: card % registered without embedding (§ 5.2)', new.card_id;
  end if;
  return new;
end $$;

create constraint trigger card_requires_embedding
  after insert on cards
  deferrable initially deferred
  for each row execute function assert_card_has_embedding();

-- ----------------------------------------------------------------------------
-- § 5 (a) Memory — per-pair episodic + community semantic
-- ----------------------------------------------------------------------------

create table memory_entries (
  memory_id   uuid primary key default gen_random_uuid(),
  kind        memory_kind not null,
  pair_id     uuid references pairs(pair_id),
  agent_id    uuid references agents(agent_id),
  content     text not null,
  activity_id uuid references activities(activity_id),
  created_at  timestamptz not null default now(),
  -- invariant: episodic entries MUST link to the triggering Cluster A activity
  check (kind <> 'episodic' or activity_id is not null)
);

-- ----------------------------------------------------------------------------
-- § 4.1 Trust signals — surface count maintained from interior entries
-- ----------------------------------------------------------------------------

create table trust_signals (
  signal_id        uuid primary key default gen_random_uuid(),
  card_id          uuid not null references cards(card_id) on delete cascade,
  signal_kind      text not null check (signal_kind in
                     ('vote','verify','flag','mark_relevant','mark_not_relevant',
                      'counterexample','caveat','provenance_attach','outcome_ping')),
  actor_kind       member_kind not null,
  actor_pair_id    uuid references pairs(pair_id),
  actor_agent_id   uuid references agents(agent_id),
  actor_strength   signal_strength not null,
  payload          jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  check (
    (actor_kind = 'pair'  and actor_pair_id is not null) or
    (actor_kind = 'agent' and actor_agent_id is not null and actor_pair_id is null)
  )
);

-- surface (cards.signal_count / verify_log) follows interior automatically —
-- consistency by construction, validated again by the checker (§ 6.3).
create or replace function apply_trust_signal()
returns trigger language plpgsql as $$
begin
  update cards
     set signal_count = (select count(*) from trust_signals t where t.card_id = new.card_id),
         verify_log = case when new.signal_kind = 'verify'
           then verify_log || jsonb_build_array(jsonb_build_object(
                  'verifier_kind', new.actor_kind,
                  'verifier', coalesce(new.actor_pair_id::text, new.actor_agent_id::text),
                  'strength', new.actor_strength,
                  'at', new.created_at,
                  'delta', new.payload))
           else verify_log end
   where card_id = new.card_id;
  return new;
end $$;

create trigger trust_signal_applied
  after insert on trust_signals
  for each row execute function apply_trust_signal();

-- ----------------------------------------------------------------------------
-- § 1.2 Boundary events — every inside↔outside crossing is logged
-- ----------------------------------------------------------------------------

create table boundary_events (
  event_id   uuid primary key default gen_random_uuid(),
  boundary   boundary_dir not null,
  event_type text not null,        -- pair_registered | agent_declared | context_handshake |
                                   -- narrative_emitted | promotion | ...
  pair_id    uuid references pairs(pair_id),
  agent_id   uuid references agents(agent_id),
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- § 6.3 SurfaceInteriorConsistencyChecker (DB half — structural checks)
-- ----------------------------------------------------------------------------

create or replace function check_surface_interior(p_card_id uuid)
returns jsonb language plpgsql as $$
declare
  c cards%rowtype;
  issues text[] := '{}';
  actual_signals int;
  mem uuid;
begin
  select * into c from cards where card_id = p_card_id;
  if not found then
    return jsonb_build_object('ok', false, 'issues', jsonb_build_array('card not found'));
  end if;

  if length(trim(c.summary)) = 0 then
    issues := issues || 'summary empty (surface must be signal-grade)';
  end if;
  if not exists (select 1 from provenance_chains p where p.provenance_id = c.provenance_id) then
    issues := issues || 'provenance_badge dangling';
  end if;
  if not exists (select 1 from embeddings e where e.card_id = c.card_id) then
    issues := issues || 'embedding missing';
  end if;

  select count(*) into actual_signals from trust_signals t where t.card_id = c.card_id;
  if actual_signals <> c.signal_count then
    issues := issues || format('signal_count drift: surface=%s interior=%s', c.signal_count, actual_signals);
  end if;

  if not validate_front_extension(c.type, c.front_extension) then
    issues := issues || 'front_extension invalid for type';
  end if;

  foreach mem in array c.memory_link loop
    if not exists (select 1 from memory_entries m where m.memory_id = mem) then
      issues := issues || format('memory_link dangling: %s', mem);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', coalesce(array_length(issues, 1), 0) = 0,
    'checked_at', now(),
    'issues', to_jsonb(issues)
  );
end $$;

create or replace function run_surface_interior_check(p_card_id uuid)
returns jsonb language plpgsql as $$
declare result jsonb;
begin
  result := check_surface_interior(p_card_id);
  update cards set surface_interior_check = result where card_id = p_card_id;
  return result;
end $$;

-- ----------------------------------------------------------------------------
-- § 8.3 Natural promotion — weak → strong, retroactive, idempotent
-- ----------------------------------------------------------------------------

create or replace function promote_to_pair(p_agent_id uuid, p_pair_id uuid)
returns jsonb language plpgsql as $$
declare
  cards_promoted int;
  signals_promoted int;
  memories_moved int;
  activities_moved int;
  touched uuid;
begin
  if not exists (select 1 from pairs where pair_id = p_pair_id) then
    raise exception 'promotion target pair % not found', p_pair_id;
  end if;

  -- content stays consistent; only identity layer + strength change (§ 9.3)
  update cards
     set attribution_kind = 'pair', pair_id = p_pair_id, signal_strength = 'strong'
   where agent_id = p_agent_id and (pair_id is distinct from p_pair_id or signal_strength = 'weak');
  get diagnostics cards_promoted = row_count;

  update trust_signals
     set actor_kind = 'pair', actor_pair_id = p_pair_id, actor_strength = 'strong'
   where actor_agent_id = p_agent_id
     and (actor_pair_id is distinct from p_pair_id or actor_strength = 'weak');
  get diagnostics signals_promoted = row_count;

  -- re-emit: recompute aggregates on every card this agent ever signaled
  for touched in
    select distinct card_id from trust_signals where actor_agent_id = p_agent_id
  loop
    update cards
       set signal_count = (select count(*) from trust_signals t where t.card_id = touched)
     where card_id = touched;
    perform run_surface_interior_check(touched);
  end loop;

  update memory_entries set pair_id = p_pair_id where agent_id = p_agent_id and pair_id is null;
  get diagnostics memories_moved = row_count;

  update activities set attribution_kind = 'pair', pair_id = p_pair_id
   where agent_id = p_agent_id and pair_id is null;
  get diagnostics activities_moved = row_count;

  update agents set promoted_to_pair = p_pair_id,
                    promoted_at = coalesce(promoted_at, now())
   where agent_id = p_agent_id;

  insert into boundary_events (boundary, event_type, pair_id, agent_id, payload)
  values ('input', 'promotion', p_pair_id, p_agent_id, jsonb_build_object(
    'cards_promoted', cards_promoted, 'signals_promoted', signals_promoted));

  return jsonb_build_object(
    'agent_id', p_agent_id, 'pair_id', p_pair_id,
    'cards_promoted', cards_promoted, 'signals_promoted', signals_promoted,
    'memories_moved', memories_moved, 'activities_moved', activities_moved);
end $$;

-- ----------------------------------------------------------------------------
-- Surface view — card front only (§ 6.2: interior never leaks through here)
-- ----------------------------------------------------------------------------

create view card_fronts as
select card_id, type, attribution_kind, pair_id, agent_id,
       signal_strength, signal_count, summary, provenance_id,
       created_at, pair_context_fingerprint, front_extension, target_card_id
from cards;

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------

create index cards_created_idx       on cards (created_at desc);
create index cards_attr_pair_idx     on cards (pair_id) where pair_id is not null;
create index cards_attr_agent_idx    on cards (agent_id) where agent_id is not null;
create index cards_target_idx        on cards (target_card_id) where target_card_id is not null;
create index cards_memlink_idx       on cards using gin (memory_link);
create index activities_pair_idx     on activities (pair_id, created_at desc);
create index activities_agent_idx    on activities (agent_id, created_at desc);
create index activities_session_idx  on activities (session_id, created_at);
create index trust_signals_card_idx  on trust_signals (card_id);
create index memory_pair_idx         on memory_entries (pair_id, created_at desc);
create index boundary_created_idx    on boundary_events (created_at desc);
create index embeddings_hnsw_idx     on embeddings using hnsw (embedding vector_cosine_ops);

-- ----------------------------------------------------------------------------
-- RLS + Supabase wiring (guarded: skipped on vanilla Postgres / PGlite)
-- ----------------------------------------------------------------------------

alter table pairs            enable row level security;
alter table agents           enable row level security;
alter table cards            enable row level security;
alter table embeddings       enable row level security;
alter table memory_entries   enable row level security;
alter table activities       enable row level security;
alter table trust_signals    enable row level security;
alter table provenance_chains enable row level security;
alter table boundary_events  enable row level security;

-- public trail (α observer): anon may read public activities + card fronts only
create policy activities_public_read on activities for select using (is_public);
create policy provenance_public_read on provenance_chains for select using (true);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on cards from anon;
    revoke all on memory_entries from anon;
    revoke all on boundary_events from anon;
    grant select on card_fronts to anon;       -- surface only
    grant select on activities to anon;        -- RLS filters to is_public
    grant select on provenance_chains to anon; -- attribution badge resolution
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table activities;  -- § 15.3 Realtime channel source
  end if;
exception when duplicate_object then null;
end $$;
