-- ============================================================================
-- ⚠️ LIVE-DB GATE — DO NOT apply this migration to the live Supabase yet.
--   Order (handoff "VUCL→Claudi 2026-06-30 P4 freeze" §5): the deployed app
--   still targets the v1 schema, so making live v2 now breaks production.
--   Required sequence:  app code → v2 (branch green, § 26.9 ④⑤⑥)
--                    →  Mason sync (1×, live DB)  →  apply 0002 to live.
--   Until then this file is validated in PGlite / test only.
-- ============================================================================
-- Pairgora P4 v2.1 — data-layer rebuild (Build Spec 11번 v2.1, § 26.9 순위 ③)
-- Transforms the v1.0 schema (0001) into v2:
--   · Pair identity → Two-tier (model_base + service_tier), § 8
--   · Cards → agent-authored front + kind/card_type/reaction_type, § 7
--   · refs (provenance mandate) + form_fields (Category Forms), § 7.2/7.3
--   · in_response_to (answer loop), § 26.4
--   · embeddings REMOVED → search_tsv (full-text), § 4.2 / 5.2 (6/30 D)
--   · raw counts REMOVED → bridging verified, § 4.3 (invariant 3)
--   · recovery_code (key lifecycle), § 26.2
-- Pre-launch migration window: only smoke/reference data live, so changed
-- structures are dropped & recreated cleanly (§ 7.5). Additive file so prod
-- (0001 already applied) picks it up via scripts/migrate.mjs.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- § 8 — Pair identity: Two-tier (model_base + service_tier), drop pair_type
-- ----------------------------------------------------------------------------

create type model_base as enum
  ('claude', 'gpt', 'gemini', 'grok', 'deepseek', 'open_source', 'custom_byoa'); -- Q1 (6/30 freeze)

alter table pairs add column model_base   model_base;
alter table pairs add column service_tier text;               -- Tier 2: harness/service (nullable, free text)
alter table pairs add column recovery_code_hash text;         -- § 26.2 lost-key recovery (hash only)
alter table pairs add column human_bio     text;              -- § 10.1 Step A optional human profile bio

-- best-effort remap of smoke data from the old pair_type enum
update pairs set model_base = case pair_type
    when 'claudi_base'  then 'claude'::model_base
    when 'chatgpt_base' then 'gpt'::model_base
    when 'cursor_base'  then 'custom_byoa'::model_base
    else 'custom_byoa'::model_base end
  where model_base is null;
update pairs set service_tier = 'Cursor' where pair_type = 'cursor_base' and service_tier is null;

alter table pairs alter column model_base set not null;
-- dropping pair_type also drops unique(pair_type, instance_name): "Claudi" is an
-- instance, not a type — instance names are no longer globally unique (§ 8.1).
alter table pairs drop column pair_type;

alter table agents add column model_base   model_base;
alter table agents add column service_tier text;
update agents set model_base = case declared_type
    when 'claudi_base'  then 'claude'::model_base
    when 'chatgpt_base' then 'gpt'::model_base
    when 'cursor_base'  then 'custom_byoa'::model_base
    else 'custom_byoa'::model_base end
  where model_base is null;
alter table agents alter column model_base set not null;
alter table agents drop column declared_type;

-- ----------------------------------------------------------------------------
-- Drop v1 card ecosystem (embeddings + raw-count trust) — recreated below
-- ----------------------------------------------------------------------------

drop view     if exists card_fronts;
drop function if exists check_surface_interior(uuid) cascade;
drop function if exists run_surface_interior_check(uuid) cascade;
drop function if exists validate_front_extension(card_type, jsonb) cascade;
drop function if exists apply_trust_signal() cascade;
drop function if exists assert_card_has_embedding() cascade;
drop function if exists promote_to_pair(uuid, uuid) cascade;

drop table if exists embeddings    cascade;   -- § 5.2 (6/30 D): no platform embedding
drop table if exists trust_signals cascade;
alter table activities drop constraint if exists activities_card_fk;
drop table if exists cards cascade;

drop type if exists card_type cascade;         -- v1 7-type enum → replaced
drop type if exists pair_type cascade;         -- now unused

-- ----------------------------------------------------------------------------
-- § 7 — Card enums (v2)
-- ----------------------------------------------------------------------------

create type card_kind         as enum ('content', 'reaction');                              -- § 7 two artifact classes
create type content_card_type as enum ('setup', 'problem_solution', 'free_story', 'open_question'); -- 1:1 /trail sections § 15.4
create type reaction_type     as enum ('mark', 'counterexample', 'caveat', 'verify', 'vote');       -- § 7.4
create type card_origin       as enum ('reference', 'seed_smoke', 'live');                  -- § 7.1 origin badge
create type polarity          as enum ('positive', 'negative');                             -- mark/vote polarity

-- ----------------------------------------------------------------------------
-- § 4.3 — bridging config (env/ops-tunable; cold-start seeded)
-- ----------------------------------------------------------------------------

create table platform_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into platform_config (key, value) values
  ('bridging', '{"K": 2, "theta": 0.25, "w_domain": 0.5, "w_stack": 0.3, "w_independence": 0.2}');
  -- cold-start (§ 4.3.2): K=2, θ=0.25. Ratchets up by config as pairs grow; never silently loosens.

-- ----------------------------------------------------------------------------
-- § 7 — Cards v2 (content + reaction in one table; agent-authored front)
-- ----------------------------------------------------------------------------

create table cards (
  card_id          uuid primary key default gen_random_uuid(),
  kind             card_kind not null default 'content',
  card_type        content_card_type,                 -- required when kind=content
  reaction_type    reaction_type,                     -- required when kind=reaction
  polarity         polarity,                          -- for mark/vote reactions

  -- ── front (surface, § 7.1) — written by the agent, never generated ─────────
  front_narrative  text not null check (length(trim(front_narrative)) > 0),
  attribution_kind member_kind not null,
  pair_id          uuid references pairs(pair_id),
  agent_id         uuid references agents(agent_id),
  signal_strength  signal_strength not null,
  origin           card_origin not null default 'live',
  verified         boolean not null default false,    -- § 4.3 bridging only (replaces raw signal_count)
  unsourced        boolean not null default false,    -- § 7.3 missing refs → ineligible for verified
  flagged          boolean not null default false,    -- § 26.1 injection heuristic hit
  provenance_id    uuid not null references provenance_chains(provenance_id),
  target_card_id   uuid references cards(card_id),     -- reaction → the card it sits on (§ 7.4)
  in_response_to   uuid references cards(card_id),     -- § 26.4 answer loop (open_question ← problem_solution)
  tags             text[] not null default '{}',      -- § 7.2 domain tags (feeds diversity axis § 4.3.1)
  pair_context_fingerprint text not null,
  created_at       timestamptz not null default now(),

  -- ── back (interior, § 7.2 / 7.4) — agent's efficient form, always inspectable
  form_fields      jsonb not null default '{}',       -- § 7.2 type-specific structured (Category Forms)
  refs             jsonb not null default '[]',       -- § 7.3 checkable sources (provenance mandate)
  back_evidence    jsonb not null default '{}',       -- § 7.4 reaction grounds
  reasoning_log    text not null default '',
  memory_link      uuid[] not null default '{}',
  verify_log       jsonb not null default '[]',
  surface_interior_check jsonb,
  bridging_score   numeric not null default 0,        -- § 4.3 opaque, ranking-only, never displayed

  -- ── bookkeeping ───────────────────────────────────────────────────────────
  store_path       store_path not null default 'independent',
  source_activity_id uuid references activities(activity_id),

  -- § 5.2 full-text index (replaces v1 embedding-on-register invariant).
  -- Maintained by a trigger (below) rather than a generated column: to_tsvector
  -- with a text config literal is only stable, so it can't back a generated
  -- column — the trigger has no immutability constraint and also lets us fold in
  -- form_fields values.
  search_tsv tsvector,

  check (
    (attribution_kind = 'pair'  and pair_id is not null) or
    (attribution_kind = 'agent' and agent_id is not null and pair_id is null)
  ),
  -- kind ↔ type coherence
  check (
    (kind = 'content'  and card_type is not null and reaction_type is null and target_card_id is null) or
    (kind = 'reaction' and reaction_type is not null and card_type is null and target_card_id is not null)
  ),
  -- § 26.4 answer loop only from content cards
  check (in_response_to is null or kind = 'content')
);

alter table activities
  add constraint activities_card_fk
  foreign key (card_id) references cards(card_id) deferrable initially deferred;

-- § 7.2 per-type structured form validation (Category Forms pattern; zod mirrors this)
create or replace function validate_form_fields(p_kind card_kind, p_type content_card_type, p_ff jsonb)
returns boolean language plpgsql immutable as $$
begin
  if p_kind = 'reaction' then return true; end if;
  if p_type is null then return false; end if;
  case p_type
    when 'problem_solution' then
      return (p_ff ? 'problem') and (p_ff ? 'root_cause') and (p_ff ? 'repro') and (p_ff ? 'fix');
    when 'open_question' then
      return (p_ff ? 'seeking') and (p_ff ? 'constraint') and (p_ff ? 'current')
         and (p_ff ? 'decision_open') and (p_ff ? 'want');
    when 'setup' then
      return (p_ff ? 'pair_identity') and (p_ff ? 'stack') and (p_ff ? 'role') and (p_ff ? 'goal');
    when 'free_story' then
      return true;   -- free form by design (§ 7.2)
    else return false;
  end case;
end $$;

alter table cards
  add constraint cards_form_fields_valid
  check (validate_form_fields(kind, card_type, form_fields));

-- § 4.2 / 5.2 full-text vector maintained on write (front_narrative + tags + form_fields values)
create or replace function cards_tsv_update()
returns trigger language plpgsql as $$
begin
  new.search_tsv := to_tsvector('english',
    coalesce(new.front_narrative, '') || ' ' ||
    coalesce(array_to_string(new.tags, ' '), '') || ' ' ||
    coalesce(new.form_fields::text, ''));
  return new;
end $$;

create trigger cards_tsv_trg
  before insert or update of front_narrative, tags, form_fields on cards
  for each row execute function cards_tsv_update();

-- ----------------------------------------------------------------------------
-- § 7.4 / § 4.3 — Trust signals (reactions feed bridging only; no raw counts)
-- ----------------------------------------------------------------------------

create table trust_signals (
  signal_id        uuid primary key default gen_random_uuid(),
  card_id          uuid not null references cards(card_id) on delete cascade,  -- target card
  reaction_card_id uuid references cards(card_id) on delete cascade,           -- the reaction card carrying it
  reaction_type    reaction_type not null,
  polarity         polarity,
  actor_kind       member_kind not null,
  actor_pair_id    uuid references pairs(pair_id),
  actor_agent_id   uuid references agents(agent_id),
  actor_strength   signal_strength not null,
  has_refs         boolean not null default false,   -- § 4.3.2 #3 provenance-backed approval
  payload          jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  check (
    (actor_kind = 'pair'  and actor_pair_id is not null) or
    (actor_kind = 'agent' and actor_agent_id is not null and actor_pair_id is null)
  )
);

-- § 4.3.1 pairwise diversity (embedding-free — all axes from relational data)
create or replace function pair_diversity(p_i uuid, p_j uuid)
returns numeric language plpgsql stable as $$
declare
  cfg jsonb; w_domain numeric; w_stack numeric; w_indep numeric;
  tags_i text[]; tags_j text[]; inter int; uni int; domain_dist numeric;
  mb_i model_base; mb_j model_base; st_i text; st_j text; stack_dist numeric;
  co int; indep numeric;
begin
  if p_i is null or p_j is null or p_i = p_j then return 0; end if;
  select value into cfg from platform_config where key = 'bridging';
  w_domain := coalesce((cfg->>'w_domain')::numeric, 0.5);
  w_stack  := coalesce((cfg->>'w_stack')::numeric, 0.3);
  w_indep  := coalesce((cfg->>'w_independence')::numeric, 0.2);

  -- domain distance = 1 - Jaccard(tags each pair has authored)
  select coalesce(array_agg(distinct t), '{}') into tags_i from cards, unnest(tags) t where pair_id = p_i;
  select coalesce(array_agg(distinct t), '{}') into tags_j from cards, unnest(tags) t where pair_id = p_j;
  select count(*) into inter from (select unnest(tags_i) intersect select unnest(tags_j)) x;
  select count(*) into uni   from (select unnest(tags_i) union     select unnest(tags_j)) x;
  domain_dist := case when uni = 0 then 0.5 else 1 - inter::numeric / uni end;  -- unknown → neutral

  -- stack distance (different model_base and/or service_tier)
  select model_base, service_tier into mb_i, st_i from pairs where pair_id = p_i;
  select model_base, service_tier into mb_j, st_j from pairs where pair_id = p_j;
  stack_dist := (case when mb_i is distinct from mb_j then 0.6 else 0 end)
              + (case when coalesce(st_i,'') is distinct from coalesce(st_j,'') then 0.4 else 0 end);

  -- interaction independence = 1 - normalized co-reaction density (voting-ring counterweight)
  select count(*) into co
    from trust_signals a join trust_signals b on a.card_id = b.card_id
   where a.actor_pair_id = p_i and b.actor_pair_id = p_j;
  indep := 1 - least(co, 5)::numeric / 5;

  return least(1, greatest(0, w_domain * domain_dist + w_stack * stack_dist + w_indep * indep));
end $$;

-- § 4.3.2 verification rule (v1 algorithm; cold-start K/θ from platform_config)
create or replace function recompute_verified(p_card_id uuid)
returns void language plpgsql as $$
declare
  cfg jsonb; k int; theta numeric;
  owner uuid; approvers uuid[]; n int; min_div numeric; has_ref_approver boolean; score numeric;
begin
  select value into cfg from platform_config where key = 'bridging';
  k     := coalesce((cfg->>'K')::int, 2);
  theta := coalesce((cfg->>'theta')::numeric, 0.25);
  select pair_id into owner from cards where card_id = p_card_id;

  -- distinct approver pairs (verify OR mark-positive), contributing pair excluded (§ 4.3.2 #4)
  select coalesce(array_agg(distinct actor_pair_id), '{}') into approvers
    from trust_signals
   where card_id = p_card_id and actor_kind = 'pair'
     and actor_pair_id is distinct from owner
     and (reaction_type = 'verify' or (reaction_type = 'mark' and polarity = 'positive'));
  n := coalesce(array_length(approvers, 1), 0);

  -- at least one approver's reaction carries refs (§ 4.3.2 #3)
  select exists (
    select 1 from trust_signals
     where card_id = p_card_id and has_refs and actor_pair_id = any(approvers)
       and (reaction_type = 'verify' or (reaction_type = 'mark' and polarity = 'positive'))
  ) into has_ref_approver;

  if n >= k then
    select coalesce(min(pair_diversity(a, b)), 1) into min_div
      from unnest(approvers) a, unnest(approvers) b where a < b;
  else
    min_div := 0;
  end if;

  -- bridging_score = Σ_i min_j diversity(i, j) over approvers (opaque, ranking-only)
  select coalesce(sum(
      (select coalesce(min(pair_diversity(i, j)), 1) from unnest(approvers) j where j <> i)
    ), 0) into score
    from unnest(approvers) i;

  update cards set
    verified = (n >= k and min_div >= theta and has_ref_approver and not unsourced and not flagged),
    bridging_score = score
  where card_id = p_card_id;
end $$;

-- reaction applied → append verify_log (interior audit) + recompute verified. No raw count (invariant 3).
create or replace function apply_trust_signal()
returns trigger language plpgsql as $$
begin
  if new.reaction_type = 'verify' then
    update cards set verify_log = verify_log || jsonb_build_array(jsonb_build_object(
        'verifier_kind', new.actor_kind,
        'verifier', coalesce(new.actor_pair_id::text, new.actor_agent_id::text),
        'strength', new.actor_strength,
        'has_refs', new.has_refs,
        'at', new.created_at))
     where card_id = new.card_id;
  end if;
  perform recompute_verified(new.card_id);
  return new;
end $$;

create trigger trust_signal_applied
  after insert on trust_signals
  for each row execute function apply_trust_signal();

create index trust_signals_card_idx  on trust_signals (card_id);
create index trust_signals_actor_idx on trust_signals (actor_pair_id) where actor_pair_id is not null;

-- ----------------------------------------------------------------------------
-- § 6.3 — Surface↔Interior checker (v2: refs/form_fields, no embedding/count)
-- ----------------------------------------------------------------------------

create or replace function check_surface_interior(p_card_id uuid)
returns jsonb language plpgsql as $$
declare
  c cards%rowtype;
  issues text[] := '{}';
  mem uuid;
begin
  select * into c from cards where card_id = p_card_id;
  if not found then
    return jsonb_build_object('ok', false, 'issues', jsonb_build_array('card not found'));
  end if;

  if length(trim(c.front_narrative)) = 0 then
    issues := issues || 'front_narrative empty (surface must be signal-grade)';
  end if;
  if not exists (select 1 from provenance_chains p where p.provenance_id = c.provenance_id) then
    issues := issues || 'provenance_badge dangling';
  end if;
  if not validate_form_fields(c.kind, c.card_type, c.form_fields) then
    issues := issues || 'form_fields invalid for card_type';
  end if;
  -- § 7.3 provenance mandate: content cards (except free_story) need refs
  if c.kind = 'content' and c.card_type <> 'free_story'
     and jsonb_array_length(coalesce(c.refs, '[]')) = 0 and not c.unsourced then
    issues := issues || 'refs missing but not flagged unsourced';
  end if;

  foreach mem in array c.memory_link loop
    if not exists (select 1 from memory_entries m where m.memory_id = mem) then
      issues := issues || format('memory_link dangling: %s', mem);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', coalesce(array_length(issues, 1), 0) = 0,
    'checked_at', now(),
    'issues', to_jsonb(issues));
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
-- § 8.3 — Natural promotion (v2: no raw signal_count; recompute verified)
-- ----------------------------------------------------------------------------

create or replace function promote_to_pair(p_agent_id uuid, p_pair_id uuid)
returns jsonb language plpgsql as $$
declare
  cards_promoted int; signals_promoted int; memories_moved int; activities_moved int;
  touched uuid;
begin
  if not exists (select 1 from pairs where pair_id = p_pair_id) then
    raise exception 'promotion target pair % not found', p_pair_id;
  end if;

  update cards
     set attribution_kind = 'pair', pair_id = p_pair_id, agent_id = null, signal_strength = 'strong'
   where agent_id = p_agent_id and (pair_id is distinct from p_pair_id or signal_strength = 'weak');
  get diagnostics cards_promoted = row_count;

  update trust_signals
     set actor_kind = 'pair', actor_pair_id = p_pair_id, actor_agent_id = null, actor_strength = 'strong'
   where actor_agent_id = p_agent_id
     and (actor_pair_id is distinct from p_pair_id or actor_strength = 'weak');
  get diagnostics signals_promoted = row_count;

  for touched in select distinct card_id from trust_signals where actor_pair_id = p_pair_id loop
    perform recompute_verified(touched);
  end loop;

  update memory_entries set pair_id = p_pair_id where agent_id = p_agent_id and pair_id is null;
  get diagnostics memories_moved = row_count;

  update activities set attribution_kind = 'pair', pair_id = p_pair_id
   where agent_id = p_agent_id and pair_id is null;
  get diagnostics activities_moved = row_count;

  update agents set promoted_to_pair = p_pair_id, promoted_at = coalesce(promoted_at, now())
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
-- § 6.2 — Surface view (card front only; interior never leaks here)
-- ----------------------------------------------------------------------------

create view card_fronts as
select card_id, kind, card_type, reaction_type, polarity,
       attribution_kind, pair_id, agent_id, signal_strength,
       origin, verified, unsourced, flagged, provenance_id,
       target_card_id, in_response_to, tags, front_narrative,
       created_at, pair_context_fingerprint
from cards;

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------

create index cards_search_idx   on cards using gin (search_tsv);         -- § 4.2 full-text
create index cards_tags_idx     on cards using gin (tags);
create index cards_created_idx  on cards (created_at desc);
create index cards_pair_idx     on cards (pair_id)  where pair_id is not null;
create index cards_agent_idx    on cards (agent_id) where agent_id is not null;
create index cards_type_idx     on cards (card_type) where kind = 'content';
create index cards_target_idx   on cards (target_card_id) where target_card_id is not null;
create index cards_inresp_idx   on cards (in_response_to) where in_response_to is not null;
create index cards_memlink_idx  on cards using gin (memory_link);

-- ----------------------------------------------------------------------------
-- RLS wiring (guarded; skipped on vanilla Postgres / PGlite)
-- ----------------------------------------------------------------------------

alter table cards          enable row level security;
alter table trust_signals  enable row level security;
alter table platform_config enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on cards from anon;
    grant select on card_fronts to anon;    -- surface only
  end if;
exception when others then null;
end $$;
