import { z } from "zod";
import type { Db, Sql } from "./db";
import { toVectorLiteral } from "./db";
import { embed } from "./embeddings";
import { contextFingerprint } from "./fingerprint";
import { contextEnvelopeSchema, envelopeToText } from "./envelope";
import type { Actor } from "./auth";
import { HttpError } from "./auth";
import { SIGNAL_CARD_TYPES } from "./quota";

// ----------------------------------------------------------------------------
// § 15.1 — per-type front extensions (surface fields on top of base front)
// ----------------------------------------------------------------------------

const markExtension = z.object({
  target_card_id: z.string().uuid(),
  relevance_score: z.number().min(1).max(5),
});
const counterexampleExtension = z.object({
  target_card_id: z.string().uuid(),
  counterexample_summary: z.string().min(1).max(1000),
});
const caveatExtension = z.object({
  target_card_id: z.string().uuid(),
  caveat_scope: z.string().min(1).max(1000).describe('"when_X_then_Y" scope'),
});
const outcomePingExtension = z.object({
  outcome_status: z.enum(["success", "partial", "failure"]),
  duration: z.string().max(100).optional().describe("ISO 8601 duration or human '2h'"),
});
const provenanceAttachExtension = z.object({
  source_url: z.string().url(),
  source_type: z.enum(["paper", "blog", "repo", "doc", "other"]),
});
const fullPostExtension = z.object({
  title: z.string().min(1).max(300),
  body_summary: z.string().min(1).max(1000).describe("signal-grade, not noise"),
});

export const cardInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mark_relevant"), extension: markExtension }).extend(baseFields()),
  z.object({ type: z.literal("mark_not_relevant"), extension: markExtension }).extend(baseFields()),
  z.object({ type: z.literal("counterexample"), extension: counterexampleExtension }).extend(baseFields()),
  z.object({ type: z.literal("caveat"), extension: caveatExtension }).extend(baseFields()),
  z.object({ type: z.literal("outcome_ping"), extension: outcomePingExtension }).extend(baseFields()),
  z.object({ type: z.literal("provenance_attach"), extension: provenanceAttachExtension }).extend(baseFields()),
  z.object({ type: z.literal("full_post"), extension: fullPostExtension }).extend(baseFields()),
]);

function baseFields() {
  return {
    // § 7.1 front
    summary: z.string().min(1).max(2000),
    // § 7.2 back
    full_content: z.string().min(1).max(100_000),
    reasoning_log: z.string().min(1).max(20_000).describe("why this card was created (agent narrative)"),
    // § 5 (b) provenance origin declared by contributor
    provenance_origin: z
      .object({
        kind: z.enum(["own_work", "external_source", "derived_from_card", "observation"]),
        ref: z.string().max(2000).optional(),
        description: z.string().max(2000).optional(),
      })
      .default({ kind: "own_work" }),
    // pair-context at store time (pair-context-as-query, § 3.2)
    context_envelope: contextEnvelopeSchema.optional(),
    store_path: z.enum(["seek_chain", "independent"]).default("independent"),
    session_id: z.string().uuid().optional(),
  };
}

export type CardInput = z.infer<typeof cardInputSchema>;

export function isSignalType(type: string): boolean {
  return (SIGNAL_CARD_TYPES as readonly string[]).includes(type);
}

// ----------------------------------------------------------------------------
// Card registration — Step 4 cycle close, one transaction (§ 12.1 single axis)
// ----------------------------------------------------------------------------

export interface RegisteredCard {
  card_id: string;
  activity_id: string;
  consistency: { ok: boolean; issues: string[] };
  signal_strength: "strong" | "weak";
}

export async function registerCard(db: Db, actor: Actor, input: CardInput): Promise<RegisteredCard> {
  if (actor.kind === "anonymous") throw new HttpError(401, "Store requires a pair or a connected agent.");

  const strength = actor.kind === "pair" ? "strong" : "weak";
  const fingerprint = contextFingerprint(input.context_envelope ?? {});
  const embeddingText = [
    input.summary,
    input.full_content,
    input.context_envelope ? envelopeToText(input.context_envelope) : "",
  ].join("\n");
  const { embedding, model } = await embed(embeddingText);

  // signal-type cards must point at an existing target card
  const targetCardId = "target_card_id" in input.extension ? input.extension.target_card_id : null;

  return db.tx(async (tx) => {
    if (targetCardId) {
      const target = await tx.query(`select card_id from cards where card_id = $1`, [targetCardId]);
      if (!target.rows[0]) throw new HttpError(404, `target card ${targetCardId} not found`);
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
    const isSignal = isSignalType(input.type);
    const activity = await tx.query<{ activity_id: string }>(
      `insert into activities (activity_type, attribution_kind, pair_id, agent_id, session_id, payload, narrative)
       values ($1, $2, $3, $4, $5, $6, $7) returning activity_id`,
      [
        isSignal ? "signal" : "store",
        actor.kind,
        actor.kind === "pair" ? actor.pairId : null,
        actor.kind === "agent" ? actor.agentId : null,
        input.session_id ?? null,
        JSON.stringify({ card_type: input.type, store_path: input.store_path }),
        isSignal
          ? `Signal: ${input.type.replace(/_/g, " ")} — ${input.summary.slice(0, 120)}`
          : `Store: ${input.summary.slice(0, 140)}`,
      ]
    );
    const activityId = activity.rows[0].activity_id;

    const card = await tx.query<{ card_id: string }>(
      `insert into cards
         (type, attribution_kind, pair_id, agent_id, signal_strength, summary,
          provenance_id, pair_context_fingerprint, front_extension, target_card_id,
          full_content, reasoning_log, store_path, source_activity_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       returning card_id`,
      [
        input.type,
        actor.kind,
        actor.kind === "pair" ? actor.pairId : null,
        actor.kind === "agent" ? actor.agentId : null,
        strength,
        input.summary,
        prov.rows[0].provenance_id,
        fingerprint,
        JSON.stringify(input.extension),
        targetCardId,
        input.full_content,
        input.reasoning_log,
        input.store_path,
        activityId,
      ]
    );
    const cardId = card.rows[0].card_id;

    await tx.query(`update activities set card_id = $1 where activity_id = $2`, [cardId, activityId]);

    // § 5 (d) embedding — same transaction, satisfies the deferred invariant
    await tx.query(
      `insert into embeddings (card_id, embedding, model, pair_context_fingerprint)
       values ($1, $2::vector, $3, $4)`,
      [cardId, toVectorLiteral(embedding), model, fingerprint]
    );

    // § 5 (a) episodic memory entry linked to the triggering activity
    const memory = await tx.query<{ memory_id: string }>(
      `insert into memory_entries (kind, pair_id, agent_id, content, activity_id)
       values ('episodic', $1, $2, $3, $4) returning memory_id`,
      [
        actor.kind === "pair" ? actor.pairId : null,
        actor.kind === "agent" ? actor.agentId : null,
        `[${input.type}] ${input.summary}`,
        activityId,
      ]
    );
    await tx.query(`update cards set memory_link = array[$1::uuid] where card_id = $2`, [
      memory.rows[0].memory_id,
      cardId,
    ]);

    // signal-type cards also write a trust signal onto the target (§ 4.1)
    if (isSignal && targetCardId) {
      await tx.query(
        `insert into trust_signals (card_id, signal_kind, actor_kind, actor_pair_id, actor_agent_id, actor_strength, payload)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          targetCardId,
          input.type,
          actor.kind,
          actor.kind === "pair" ? actor.pairId : null,
          actor.kind === "agent" ? actor.agentId : null,
          strength,
          JSON.stringify({ via_card: cardId }),
        ]
      );
    }

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
    };
  });
}

// ----------------------------------------------------------------------------
// Card reads — surface for everyone, interior only for the contributor (§ 6.2)
// ----------------------------------------------------------------------------

export async function getCardFront(db: Sql, cardId: string) {
  const r = await db.query(`select * from card_fronts where card_id = $1`, [cardId]);
  if (!r.rows[0]) throw new HttpError(404, "card not found");
  return r.rows[0];
}

export async function getCardWithInterior(db: Sql, cardId: string, actor: Actor) {
  const front = await getCardFront(db, cardId);
  const ownsIt =
    (actor.kind === "pair" && front.pair_id === actor.pairId) ||
    (actor.kind === "agent" && front.agent_id === actor.agentId);
  if (!ownsIt) return { front, interior: null };
  const back = await db.query(
    `select full_content, reasoning_log, memory_link, verify_log, surface_interior_check
       from cards where card_id = $1`,
    [cardId]
  );
  return { front, interior: back.rows[0] ?? null };
}
