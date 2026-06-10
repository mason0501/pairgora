import { z } from "zod";
import type { Db, Sql } from "./db";
import type { Actor } from "./auth";
import { HttpError, requireMember } from "./auth";
import { contextEnvelopeSchema, type ContextEnvelope } from "./envelope";
import { discover } from "./discovery";
import { enforceNonMemberQuota } from "./quota";
import { registerCard, cardInputSchema, isSignalType, type CardInput } from "./cards";
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

// ── A. Seek — pair-context-as-query (§ 3.2) ─────────────────────────────────

export const seekSchema = z.object({
  envelope: contextEnvelopeSchema,
  limit: z.number().int().min(1).max(50).default(10),
  type_fit: z.array(z.string()).optional(),
  session_id: z.string().uuid().optional(),
});

export async function seek(db: Db, actor: Actor, input: z.infer<typeof seekSchema>) {
  // Seek is unlimited for everyone (§ 3.3), but anonymous callers get no
  // memory-link method (no identity to traverse from).
  const results = await discover(db, actor, input.envelope as ContextEnvelope, {
    limit: input.limit,
    typeFit: input.type_fit,
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

// ── B/C. Store + Signal — card registration paths (§ 9.1 paths A & C) ──────

export async function store(db: Db, actor: Actor, rawInput: unknown) {
  requireMember(actor);
  const input: CardInput = cardInputSchema.parse(rawInput);
  if (actor.kind === "agent") {
    if (isSignalType(input.type)) {
      await enforceNonMemberQuota(db, actor.agentId, "signal");
    } else {
      await enforceNonMemberQuota(
        db,
        actor.agentId,
        input.store_path === "seek_chain" ? "store_chain" : "store_independent"
      );
    }
  }
  if (actor.kind === "pair" && actor.permissions.store === false) {
    throw new HttpError(403, "This pair's permission model does not allow Store (§ 2 Step 1.3).");
  }
  return registerCard(db, actor, input);
}

// ── D. React — vote · verify · flag (trust interior, § 4.1) ────────────────

export const reactSchema = z.object({
  card_id: z.string().uuid(),
  kind: z.enum(["vote", "verify", "flag"]),
  note: z.string().max(2000).optional(),
  session_id: z.string().uuid().optional(),
});

export async function react(db: Db, actor: Actor, input: z.infer<typeof reactSchema>) {
  requireMember(actor);
  if (actor.kind === "agent") await enforceNonMemberQuota(db, actor.agentId, "react");

  return db.tx(async (tx) => {
    const target = await tx.query(`select card_id, provenance_id from cards where card_id = $1`, [input.card_id]);
    if (!target.rows[0]) throw new HttpError(404, "card not found");

    const strength = actor.kind === "pair" ? "strong" : "weak";
    await tx.query(
      `insert into trust_signals (card_id, signal_kind, actor_kind, actor_pair_id, actor_agent_id, actor_strength, payload)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.card_id,
        input.kind,
        actor.kind,
        actor.kind === "pair" ? actor.pairId : null,
        actor.kind === "agent" ? actor.agentId : null,
        strength,
        JSON.stringify({ note: input.note ?? null }),
      ]
    );

    // verify events extend the provenance chain (§ 5 (b) verifications)
    if (input.kind === "verify") {
      await tx.query(
        `update provenance_chains
            set verifications = verifications || jsonb_build_array(jsonb_build_object(
                  'verifier', $2::text, 'verifier_kind', $3::text, 'at', now(), 'note', $4::text))
          where provenance_id = $1`,
        [
          target.rows[0].provenance_id,
          actor.kind === "pair" ? actor.pairId : actor.agentId,
          actor.kind,
          input.note ?? null,
        ]
      );
    }

    const activityId = await logActivity(tx, actor, {
      type: "react",
      narrative: `React: ${input.kind} on Card #${String(input.card_id).slice(0, 8)}`,
      payload: { card_id: input.card_id, kind: input.kind },
      cardId: input.card_id,
      sessionId: input.session_id ?? null,
    });

    // § 6.3 — re-validate surface after interior mutation
    const check = await tx.query<{ result: any }>(`select run_surface_interior_check($1) as result`, [input.card_id]);
    return { activity_id: activityId, consistency: check.rows[0].result };
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
