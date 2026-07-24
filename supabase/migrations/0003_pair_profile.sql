-- ============================================================================
-- Pairgora Pair Profile 검사 v0.1 — persistence layer (design note 21)
-- Additive on top of 0002. Scoring itself lives in src/lib/profile.ts and is
-- deterministic / zero-LLM (invariant): the DB stores the question catalog,
-- the accumulated raw responses (core asset — Mason 2026-07-23), and the
-- scored results. A pair takes the test twice — the agent's deep form
-- (binary, from real collaboration logs) and the human's short form
-- (likert5 self-report); the observed↔self-report delta is the product.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums — mirror the src/lib/profile.ts constants exactly
-- ----------------------------------------------------------------------------

create type profile_axis as enum (
  -- L1 — pair operating contract
  'delegation_breadth', 'context_handoff', 'initiative_direction',
  'output_absorption', 'failure_handling',
  -- L2 — human directionality (direction only, never level)
  'exploration_taste', 'decision_style', 'trust_rhythm'
);

create type profile_pole    as enum ('A', 'B');                    -- § 1.1 both poles equal
create type question_format as enum ('binary', 'likert5');         -- deep vs short instrument
create type profile_form    as enum ('deep', 'short');             -- which test a question belongs to
create type profile_answer  as enum (
  'strongly_agree', 'agree', 'neutral', 'disagree', 'strongly_disagree',
  'unobserved'                                                     -- § 1.3 first-class: thin logs are signal
);
create type profile_source  as enum ('agent_deep', 'human_short'); -- who answered

-- ----------------------------------------------------------------------------
-- Question catalog — human-readable ids ('d-del-01'); the real pool ships as
-- data separately (no seed here — 0001/0002 seed no catalogs either)
-- ----------------------------------------------------------------------------

create table profile_questions (
  question_id text primary key check (length(trim(question_id)) > 0),
  axis        profile_axis not null,
  pole        profile_pole not null,                -- agreeing pushes toward this pole
  weight      smallint not null check (weight in (1, 2)),  -- 2 = core question (§ 4 rule 1)
  format      question_format not null,
  prompt      text not null check (length(trim(prompt)) > 0),
  form        profile_form not null,                -- derivable from format; explicit for querying
  active      boolean not null default true,        -- retire questions without deleting responses
  ordering    int not null default 0,
  created_at  timestamptz not null default now(),
  -- form ↔ format coherence: deep is binary (log evidence), short is likert5
  check (
    (form = 'deep'  and format = 'binary') or
    (form = 'short' and format = 'likert5')
  )
);

-- ----------------------------------------------------------------------------
-- Raw responses — submission-grouped, accumulated. Never deleted/overwritten:
-- longitudinal retakes are expected and the raw answers are the asset.
-- ----------------------------------------------------------------------------

create table profile_submissions (
  submission_id uuid primary key default gen_random_uuid(),
  pair_id       uuid not null references pairs(pair_id),
  source        profile_source not null,
  submitted_at  timestamptz not null default now()
);

create table profile_responses (
  submission_id uuid not null references profile_submissions(submission_id),
  question_id   text not null references profile_questions(question_id),
  answer        profile_answer not null,
  primary key (submission_id, question_id)          -- one answer per question per take
);

-- ----------------------------------------------------------------------------
-- Scored results — one row per submission (scoreProfile output, frozen).
-- approved_at: the agent-written profile of the human needs the human's
-- approval before it is publishable (guardrail); self-report approves itself.
-- published_card_id: reserved for the later publish step (registerCard).
-- ----------------------------------------------------------------------------

create table profile_results (
  result_id       uuid primary key default gen_random_uuid(),
  pair_id         uuid not null references pairs(pair_id),
  source          profile_source not null,
  submission_id   uuid not null references profile_submissions(submission_id),
  axes            jsonb not null,                   -- full ProfileResult.axes
  type_code       text,                             -- 4-letter surface code; null while unresolved → retake
  unresolved_axes text[] not null default '{}',
  completeness    numeric not null,                 -- answered weight / presented weight (§ 1.3)
  theta           numeric not null,                 -- θ this result was scored with (audit)
  approved_at     timestamptz,                      -- null = not publishable yet
  published_card_id uuid references cards(card_id), -- set by the future publish step only
  created_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- θ config — resolution threshold, ops-tunable (DEFAULT_THETA fallback in code)
-- ----------------------------------------------------------------------------

insert into platform_config (key, value) values
  ('profile_theta', '0.2');
  -- |score| < θ = unresolved (§ 4 rule 4). Ratchets by config as the question
  -- pool and log depth grow; scoring code falls back to DEFAULT_THETA (0.2).

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------

create index profile_questions_form_idx    on profile_questions (form, ordering) where active;
create index profile_submissions_pair_idx  on profile_submissions (pair_id, submitted_at desc);
create index profile_results_latest_idx    on profile_results (pair_id, source, created_at desc);

-- ----------------------------------------------------------------------------
-- RLS wiring (guarded pattern; skipped on vanilla Postgres / PGlite)
-- ----------------------------------------------------------------------------

alter table profile_questions   enable row level security;
alter table profile_submissions enable row level security;
alter table profile_responses   enable row level security;
alter table profile_results     enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on profile_submissions from anon;
    revoke all on profile_responses   from anon;
    revoke all on profile_results     from anon;
  end if;
exception when others then null;
end $$;
