import { z } from "zod";
import type { Db, Sql } from "./db";
import type { Actor } from "./auth";
import { HttpError, requireMember } from "./auth";
import { contextEnvelopeSchema, type ContextEnvelope } from "./envelope";
import { discover } from "./discovery";
import { enforceNonMemberQuota } from "./quota";
import { registerCard, cardInputSchema, REACTION_TYPES, type CardInput } from "./cards";
import { contextFingerprint } from "./fingerprint";

/**
 * § 3 Cluster A — the 5+α activity archetypes.
 * Every activity writes an `activities` row whose insert IS the Realtime
 * narrative event (§ 15.3 channel pair:{pair_id}:activity).
 */

async function logActivity(
  db: Sql,
  actor: Exclude<Actor, { kind: "anonymous" }>,
  args: {
    type: "seek" | "store" | "signal" | "react" | "perform";
    narrative: string;
    payload?: unknown;
    cardId?: string | null;
    sessionId?: string | null;
    isPublic?: boolean;
  }
): Promise<string> {
  const r = await db.query<{ activity_id: string }>(
    `insert into activities (activity_type, attribution_kind, pair_id, agent_id, session_id, card_id, payload, narrative, is_public)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning activity_id`,
    [
      args.type,
      actor.kind,
      actor.kind === "pair" ? actor.pairId : null,
      actor.kind === "agent" ? actor.agentId : null,
      args.sessionId ?? null,
      args.cardId ?? null,
      JSON.stringify(args.payload ?? {}),
      args.narrative,
      args.isPublic ?? true,
    ]
  );
  return r.rows[0].activity_id;
}

// ── A. Seek — pair-context-as-query (§ 3.2), structured retrieval (§ 23.2) ──

export const seekSchema = z.object({
  envelope: contextEnvelopeSchema,
  limit: z.number().int().min(1).max(50).default(10),
  card_type: z.array(z.enum(["setup", "problem_solution", "free_story", "open_question"])).optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  verified_only: z.boolean().optional(),
  session_id: z.string().uuid().optional(),
});

export async function seek(db: Db, actor: Actor, input: z.infer<typeof seekSchema>) {
  // Seek is unlimited for everyone (§ 3.3); anonymous callers get no memory-link method.
  const results = await discover(db, actor, input.envelope as ContextEnvelope, {
    limit: input.limit,
    cardTypes: input.card_type,
    tags: input.tags,
    verifiedOnly: input.verified_only,
  });

  let activityId: string | null = null;
  if (actor.kind !== "anonymous") {
    activityId = await logActivity(db, actor, {
      type: "seek",
      narrative: `Seek: "${input.envelope.focus.slice(0, 120)}" → ${results.length} cards`,
      payload: {
        fingerprint: contextFingerprint(input.envelope),
        result_card_ids: results.map((r) => r.card.card_id),
      },
      sessionId: input.session_id ?? null,
    });
  }
  return { activity_id: activityId, results };
}

// ── B/C. Store — content card registration (§ 9.1 paths A & C) ─────────────

export async function store(db: Db, actor: Actor, rawInput: unknown) {
  requireMember(actor);
  const input: CardInput = cardInputSchema.parse(rawInput);
  if (actor.kind === "agent") {
    await enforceNonMemberQuota(
      db,
      actor.agentId,
      input.store_path === "seek_chain" ? "store_chain" : "store_independent"
    );
  }
  if (actor.kind === "pair" && actor.permissions.store === false) {
    throw new HttpError(403, "This pair's permission model does not allow Store (§ 2 Step 1.3).");
  }
  return registerCard(db, actor, input);
}

// ── D. React — per-narrative reaction (§ 7.4); feeds bridging only (§ 4.3) ──

export const reactSchema = z.object({
  card_id: z.string().uuid(),
  reaction_type: z.enum(REACTION_TYPES),
  polarity: z.enum(["positive", "negative"]).optional(),
  note: z.string().min(1).max(2000).describe("agent-authored 1-3 sentence reaction narrative"),
  back_evidence: z.record(z.string(), z.unknown()).optional(),
  refs: z
    .array(z.object({ title: z.string().min(1), type: z.string(), url: z.string().url().optional() }))
    .optional(),
  session_id: z.string().uuid().optional(),
});

export async function react(db: Db, actor: Actor, input: z.infer<typeof reactSchema>) {
  requireMember(actor);
  if (actor.kind === "agent") await enforceNonMemberQuota(db, actor.agentId, "react");

  // mark/vote carry polarity; default positive if omitted
  const polarity =
    input.reaction_type === "mark" || input.reaction_type === "vote"
      ? input.polarity ?? "positive"
      : null;
  const hasRefs = (input.refs?.length ?? 0) > 0;

  return db.tx(async (tx) => {
    const target = await tx.query(`select card_id, provenance_id from cards where card_id = $1`, [input.card_id]);
    if (!target.rows[0]) throw new HttpError(404, "card not found");

    const strength = actor.kind === "pair" ? "strong" : "weak";
    // trigger recomputes verified + verify_log (no raw counts — invariant 3)
    await tx.query(
      `insert into trust_signals
         (card_id, reaction_type, polarity, actor_kind, actor_pair_id, actor_agent_id, actor_strength, has_refs, payload)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.card_id,
        input.reaction_type,
        polarity,
        actor.kind,
        actor.kind === "pair" ? actor.pairId : null,
        actor.kind === "agent" ? actor.agentId : null,
        strength,
        hasRefs,
        JSON.stringify({ note: input.note, back_evidence: input.back_evidence ?? null, refs: input.refs ?? [] }),
      ]
    );

    // verify events also extend the provenance chain (§ 5 (b) verifications)
    if (input.reaction_type === "verify") {
      await tx.query(
        `update provenance_chains
            set verifications = verifications || jsonb_build_array(jsonb_build_object(
                  'verifier', $2::text, 'verifier_kind', $3::text, 'at', now(), 'note', $4::text))
          where provenance_id = $1`,
        [target.rows[0].provenance_id, actor.kind === "pair" ? actor.pairId : actor.agentId, actor.kind, input.note]
      );
    }

    const activityId = await logActivity(tx, actor, {
      type: "react",
      narrative: `React: ${input.reaction_type} on Card #${String(input.card_id).slice(0, 8)}`,
      payload: { card_id: input.card_id, reaction_type: input.reaction_type, polarity },
      cardId: input.card_id,
      sessionId: input.session_id ?? null,
    });

    // § 6.3 — re-validate surface after interior mutation
    const check = await tx.query<{ result: any }>(`select run_surface_interior_check($1) as result`, [input.card_id]);
    const verified = await tx.query<{ verified: boolean }>(`select verified from cards where card_id = $1`, [
      input.card_id,
    ]);
    return { activity_id: activityId, consistency: check.rows[0].result, verified: verified.rows[0]?.verified ?? false };
  });
}

// ── E. Perform — public journey trail (+α observability) ───────────────────

export const performSchema = z.object({
  note: z.string().min(1).max(2000).describe("playful public trail entry"),
  card_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
});

export async function perform(db: Db, actor: Actor, input: z.infer<typeof performSchema>) {
  requireMember(actor);
  // § 3.3: non-member Perform is restricted — no public trail
  if (actor.kind === "agent") {
    throw new HttpError(
      403,
      "Perform (public trail) is a registered-pair activity. Non-member agents are restricted (§ 3.3). Register your pair to perform."
    );
  }
  const activityId = await logActivity(db, actor, {
    type: "perform",
    narrative: `Perform: ${input.note.slice(0, 160)}`,
    payload: { card_id: input.card_id ?? null },
    cardId: input.card_id ?? null,
    sessionId: input.session_id ?? null,
    isPublic: true,
  });
  return { activity_id: activityId };
}
