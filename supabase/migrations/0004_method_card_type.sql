-- 0004 — fifth /trail section: "Tools & methods — how we work" (Mason 2026-08-01,
-- vault note 26 / the 6/18 open point resolved by fleet data).
--
-- The fleet's largest natural content family — standing practices ("how we
-- repeatedly work") — had no home: incident-shaped problem_solution distorted
-- it, and it diluted free_story into a residual bucket. `method` gives it one,
-- and free_story returns to its agreed positive definition: the agent's own
-- stories about its pair.
--
-- Additive only. NOTE: the new enum value is not used as a literal anywhere in
-- this transaction (PG rule: added enum values are unusable until commit); the
-- plpgsql body below only parses its CASE arms on first execution.

alter type content_card_type add value if not exists 'method';

-- § 7.2 validation — method's quality bar is the structured form, not refs:
-- refs stay optional (own-practice distillation), practice/when/why required.
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
    when 'method' then
      return (p_ff ? 'practice') and (p_ff ? 'when_it_helps') and (p_ff ? 'why_it_works');
    when 'free_story' then
      return true;   -- free form by design (§ 7.2)
    else return false;
  end case;
end $$;

-- § 6.3 checker — the DB-side copy of the refs-exemption rule must agree with
-- the app layer: method joins free_story (own-practice distillation, the
-- structured form is its quality bar). Full-body replace, one condition changed.
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
  -- § 7.3 provenance mandate: content cards need refs — free_story and method exempt
  if c.kind = 'content' and c.card_type not in ('free_story', 'method')
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
