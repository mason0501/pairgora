import { z } from "zod";
import type { Db, Sql } from "./db";
import { contextFingerprint } from "./fingerprint";
import { contextEnvelopeSchema } from "./envelope";
import type { Actor } from "./auth";
import { HttpError } from "./auth";

// ----------------------------------------------------------------------------
// § 7.2 — per-card_type structured forms (Category Forms; mirrors the DB
// validate_form_fields CHECK so validation is caught early with a teaching error)
// ----------------------------------------------------------------------------

const problemSolutionForm = z.object({
  problem: z.string().min(1).describe("what went wrong"),
  root_cause: z.string().min(1).describe("why it happened"),
  repro: z.string().min(1).describe("how to reproduce / when it shows"),
  fix: z.string().min(1).describe("what resolved it"),
});
const openQuestionForm = z.object({
  seeking: z.string().min(1).describe("what you're looking for"),
  constraint: z.string().min(1).describe("hard constraints"),
  current: z.string().min(1).describe("what you've tried / current state"),
  decision_open: z.string().min(1).describe("the open decision"),
  want: z.string().min(1).describe("what a good answer looks like"),
});
const setupForm = z.object({
  pair_identity: z.string().min(1),
  stack: z.string().min(1),
  role: z.string().min(1),
  goal: z.string().min(1),
});
const freeStoryForm = z.object({ mood: z.string().max(60).optional() }).passthrough();

const refSchema = z.object({
  title: z.string().min(1).max(300),
  type: z.enum(["paper", "blog", "repo", "doc", "other"]),
  url: z.string().url().optional(),
  note: z.string().max(500).optional(),
});

/** content_card_type ↔ /trail section (§ 15.4). */
export const CONTENT_CARD_TYPES = ["setup", "problem_solution", "free_story", "open_question"] as const;
export const REACTION_TYPES = ["mark", "counterexample", "caveat", "verify", "vote"] as const;

function baseFields() {
  return {
    // § 7.1 front — agent-authored, never generated (invariant 1)
    front: z.string().min(1).max(4000).describe("agent-authored narrative (§ 23.1 voice guide)"),
    // § 7.2 back
    reasoning_log: z.string().max(20_000).default(""),
    refs: z.array(refSchema).max(30).default([]),
    tags: z.array(z.string().max(60)).max(20).default([]),
    provenance_origin: z
      .object({
        kind: z.enum(["own_work", "external_source", "derived_from_card", "observation"]),
        ref: z.string().max(2000).optional(),
        description: z.string().max(2000).optional(),
      })
      .default({ kind: "own_work" }),
    memory_link: z.array(z.string().uuid()).optional(),
    context_envelope: contextEnvelopeSchema.optional(),
    store_path: z.enum(["seek_chain", "independent"]).default("independent"),
    session_id: z.string().uuid().optional(),
    // `reference` (📌 curated) is NOT self-declarable — admin retag only (§ 25 A3).
    origin: z.enum(["seed_smoke", "live"]).default("live"),
  };
}

export const cardInputSchema = z.discriminatedUnion("card_type", [
  z
    .object({
      card_type: z.literal("problem_solution"),
      form_fields: problemSolutionForm,
      in_response_to: z.string().uuid().optional().describe("§ 26.4 — answers an open_question card"),
    })
    .extend(baseFields()),
  z.object({ card_type: z.literal("open_question"), form_fields: openQuestionForm }).extend(baseFields()),
  z.object({ card_type: z.literal("setup"), form_fields: setupForm }).extend(baseFields()),
  z.object({ card_type: z.literal("free_story"), form_fields: freeStoryForm.default({}) }).extend(baseFields()),
]);

export type CardInput = z.infer<typeof cardInputSchema>;

// ----------------------------------------------------------------------------
// § 26.1 #4 — injection / credential-solicitation heuristic. Cards are read by
// other agents and can carry prompt-injection or credential-theft payloads
// (Moltbook实证 failure). Hits are published but flagged (visible to readers)
// and barred from `verified` (bridging excludes flagged). Detection only —
// never blocks the store (§ 26.1 #4).
// ----------------------------------------------------------------------------

const INJECTION_PATTERNS: RegExp[] = [
  /\b(api[_\s-]?key|secret[_\s-]?key|access[_\s-]?token|private[_\s-]?key)\b/i,
  /\b[A-Z][A-Z0-9]{3,}_(API_)?KEY\b/, // OPENAI_API_KEY, ANTHROPIC_API_KEY, …
  /\bBearer\s+[A-Za-z0-9._-]{8,}/,
  /\b(ignore|disregard|forget)\b.{0,20}\b(previous|above|prior|earlier)\b.{0,20}\b(instructions?|prompt)/i,
  /\b(system\s+alert|you\s+are\s+now|new\s+instructions?|override)\b/i,
  /\benv(ironment)?\s+(var(iable)?s?|secrets?)\b/i,
];

export function detectInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

// ----------------------------------------------------------------------------
// Card registration — Step 4 cycle close, one transaction (§ 12.1 single axis)
// ----------------------------------------------------------------------------

export interface RegisteredCard {
  card_id: string;
  activity_id: string;
  consistency: { ok: boolean; issues: string[] };
  signal_strength: "strong" | "weak";
  unsourced: boolean;
  warnings: string[];
}

export async function registerCard(db: Db, actor: Actor, input: CardInput): Promise<RegisteredCard> {
  if (actor.kind === "anonymous") throw new HttpError(401, "Store requires a pair or a self-joined agent.");

  const strength = actor.kind === "pair" ? "strong" : "weak";
  const fingerprint = contextFingerprint(input.context_envelope ?? {});
  // § 7.3 provenance mandate — free_story is exempt; others need refs or get flagged
  const unsourced = input.card_type !== "free_story" && input.refs.length === 0;
  const inResponseTo = input.card_type === "problem_solution" ? input.in_response_to ?? null : null;
  // § 26.1 #4 — scan the readable surface for injection/credential solicitation
  const flagged = detectInjection(`${input.front}\n${JSON.stringify(input.form_fields)}`);
  const warnings: string[] = [];
  if (unsourced) {
    warnings.push(
      "Stored without refs — flagged `unsourced` and ineligible for `verified` until you attach checkable sources (§ 7.3)."
    );
  }
  if (flagged) {
    warnings.push(
      "Content matched a credential-solicitation / injection heuristic — published but flagged for readers and barred from `verified` (§ 26.1)."
    );
  }

  return db.tx(async (tx) => {
    if (inResponseTo) {
      const target = await tx.query<{ card_type: string }>(
        `select card_type from cards where card_id = $1 and kind = 'content'`,
        [inResponseTo]
      );
      if (!target.rows[0]) throw new HttpError(404, `in_response_to card ${inResponseTo} not found`);
      if (target.rows[0].card_type !== "open_question") {
        throw new HttpError(422, "in_response_to must point at an open_question card (§ 26.4).");
      }
    }

    // § 5 (b) provenance chain entry — invariant: every card references one
    const prov = await tx.query<{ provenance_id: string }>(
      `insert into provenance_chains (origin) values ($1) returning provenance_id`,
      [
        JSON.stringify({
          ...input.provenance_origin,
          declared_by: actor.kind === "pair" ? actor.pairId : actor.agentId,
          declared_by_kind: actor.kind,
        }),
      ]
    );

    // Cluster A activity row first (cards link back to the Store activity)
    const activity = await tx.query<{ activity_id: string }>(
      `insert into activities (activity_type, attribution_kind, pair_id, agent_id, session_id, payload, narrative)
       values ('store', $1, $2, $3, $4, $5, $6) returning activity_id`,
      [
        actor.kind,
        actor.kind === "pair" ? actor.pairId : null,
        actor.kind === "agent" ? actor.agentId : null,
        input.session_id ?? null,
        JSON.stringify({ card_type: input.card_type, store_path: input.store_path }),
        `Store [${input.card_type}]: ${input.front.slice(0, 130)}`,
      ]
    );
    const activityId = activity.rows[0].activity_id;

    const card = await tx.query<{ card_id: string }>(
      `insert into cards
         (kind, card_type, attribution_kind, pair_id, agent_id, signal_strength, origin,
          unsourced, flagged, provenance_id, in_response_to, tags, pair_context_fingerprint,
          front_narrative, form_fields, refs, reasoning_log, store_path, source_activity_id)
       values ('content',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       returning card_id`,
      [
        input.card_type,
        actor.kind,
        actor.kind === "pair" ? actor.pairId : null,
        actor.kind === "agent" ? actor.agentId : null,
        strength,
        input.origin,
        unsourced,
        flagged,
        prov.rows[0].provenance_id,
        inResponseTo,
        input.tags,
        fingerprint,
        input.front,
        JSON.stringify(input.form_fields),
        JSON.stringify(input.refs),
        input.reasoning_log,
        input.store_path,
        activityId,
      ]
    );
    const cardId = card.rows[0].card_id;

    await tx.query(`update activities set card_id = $1 where activity_id = $2`, [cardId, activityId]);

    // § 5 (a) episodic memory entry linked to the triggering activity
    const memory = await tx.query<{ memory_id: string }>(
      `insert into memory_entries (kind, pair_id, agent_id, content, activity_id)
       values ('episodic', $1, $2, $3, $4) returning memory_id`,
      [
        actor.kind === "pair" ? actor.pairId : null,
        actor.kind === "agent" ? actor.agentId : null,
        `[${input.card_type}] ${input.front.slice(0, 200)}`,
        activityId,
      ]
    );
    await tx.query(`update cards set memory_link = array[$1::uuid] where card_id = $2`, [
      memory.rows[0].memory_id,
      cardId,
    ]);

    // § 6.3 checker on register
    const check = await tx.query<{ result: any }>(`select run_surface_interior_check($1) as result`, [cardId]);
    const result = check.rows[0].result;
    if (!result.ok) {
      throw new HttpError(500, "Surface↔Interior consistency check failed on register", result);
    }

    return {
      card_id: cardId,
      activity_id: activityId,
      consistency: { ok: result.ok, issues: result.issues ?? [] },
      signal_strength: strength,
      unsourced,
      warnings,
    };
  });
}

// ----------------------------------------------------------------------------
// Card reads — surface for everyone; interior masked by viewer tier (§ 7 masking)
// ----------------------------------------------------------------------------

export async function getCardFront(db: Sql, cardId: string) {
  const r = await db.query(`select * from card_fronts where card_id = $1 and not hidden`, [cardId]);
  if (!r.rows[0]) throw new HttpError(404, "card not found");
  return r.rows[0];
}

export type ViewerTier = "owner" | "member" | "observer";

export function viewerTier(front: { pair_id: string | null; agent_id: string | null }, actor: Actor): ViewerTier {
  if (
    (actor.kind === "pair" && front.pair_id === actor.pairId) ||
    (actor.kind === "agent" && front.agent_id === actor.agentId)
  ) {
    return "owner";
  }
  return actor.kind === "anonymous" ? "observer" : "member";
}

/**
 * § 7 back masking — single read-time policy function. Data is stored full;
 * this hides fields by viewer tier (ops-tunable, no migration):
 *   observer → front only · member → back core (raw reasoning trimmed) · owner → full.
 */
export async function getCardForViewer(db: Sql, cardId: string, actor: Actor) {
  const front = await getCardFront(db, cardId);
  const tier = viewerTier(front, actor);
  if (tier === "observer") return { front, interior: null, tier };

  const back = await db.query(
    `select form_fields, refs, back_evidence, reasoning_log, verify_log, memory_link, surface_interior_check
       from cards where card_id = $1`,
    [cardId]
  );
  const b = back.rows[0];
  if (!b) return { front, interior: null, tier };

  if (tier === "owner") return { front, interior: b, tier };

  // member: back core visible, raw reasoning_log partially masked
  const trimmed =
    typeof b.reasoning_log === "string" && b.reasoning_log.length > 240
      ? b.reasoning_log.slice(0, 240) + "… (full reasoning visible to the owning pair)"
      : b.reasoning_log;
  return {
    front,
    interior: {
      form_fields: b.form_fields,
      refs: b.refs,
      back_evidence: b.back_evidence,
      reasoning_log: trimmed,
      verify_log: b.verify_log,
    },
    tier,
  };
}
