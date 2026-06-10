import { z } from "zod";
import { randomUUID } from "crypto";
import type { Db, Sql } from "./db";
import { issueApiKey } from "./apikey";
import { logBoundaryEvent } from "./boundary";
import { contextEnvelopeSchema } from "./envelope";
import { HttpError, type Actor } from "./auth";

export const PAIR_TYPE_CATALOG = ["claudi_base", "chatgpt_base", "cursor_base", "custom_byoa"] as const; // § 15 #4

// ── § 10.1 internal joining — "Register your pair" ──────────────────────────

export const registerPairSchema = z.object({
  pair_type: z.enum(PAIR_TYPE_CATALOG),
  instance_name: z.string().min(1).max(120).describe('e.g., "Mason\'s Claudi"'),
  human_label: z.string().max(120).optional(),
  email: z.string().email().optional(),
  context_envelope: contextEnvelopeSchema.optional(),
  permissions: z
    .object({ store: z.boolean(), signal: z.boolean(), react: z.boolean(), perform: z.boolean() })
    .partial()
    .optional(),
});

export async function registerPair(db: Db, input: z.infer<typeof registerPairSchema>) {
  const { key, hash } = issueApiKey("pair");
  return db.tx(async (tx) => {
    const existing = await tx.query(
      `select pair_id from pairs where pair_type = $1 and instance_name = $2`,
      [input.pair_type, input.instance_name]
    );
    if (existing.rows[0]) {
      throw new HttpError(409, `Instance "${input.instance_name}" already exists for ${input.pair_type} (§ 8.1 instance uniqueness).`);
    }

    const permissions = { store: true, signal: true, react: true, perform: true, ...(input.permissions ?? {}) };
    const r = await tx.query<{ pair_id: string }>(
      `insert into pairs (pair_type, instance_name, human_label, email, api_key_hash, permissions, context_envelope)
       values ($1,$2,$3,$4,$5,$6,$7) returning pair_id`,
      [
        input.pair_type,
        input.instance_name,
        input.human_label ?? null,
        input.email ?? null,
        hash,
        JSON.stringify(permissions),
        input.context_envelope ? JSON.stringify(input.context_envelope) : null,
      ]
    );
    const pairId = r.rows[0].pair_id;

    // § 1.2 — registration is an input-boundary crossing
    await logBoundaryEvent(tx, {
      boundary: "input",
      eventType: "pair_registered",
      pairId,
      payload: { pair_type: input.pair_type, instance_name: input.instance_name },
    });
    if (input.context_envelope) {
      await logBoundaryEvent(tx, {
        boundary: "input",
        eventType: "context_handshake",
        pairId,
        payload: { fingerprint_input: true },
      });
    }

    return {
      pair_id: pairId,
      api_key: key, // shown exactly once — only hash is stored
      session_id: randomUUID(),
      promise: MAIN_PROMISE, // § 11.1
    };
  });
}

// ── § 10.2 external joining — "Connect your agent" (non-member) ─────────────

export const declareAgentSchema = z.object({
  declared_type: z.enum(PAIR_TYPE_CATALOG), // Type only, no Instance (§ 8.2)
});

export async function declareAgent(db: Db, input: z.infer<typeof declareAgentSchema>) {
  const { key, hash } = issueApiKey("agent");
  return db.tx(async (tx) => {
    const r = await tx.query<{ agent_id: string }>(
      `insert into agents (declared_type, api_key_hash) values ($1, $2) returning agent_id`,
      [input.declared_type, hash]
    );
    await logBoundaryEvent(tx, {
      boundary: "input",
      eventType: "agent_declared",
      agentId: r.rows[0].agent_id,
      payload: { declared_type: input.declared_type },
    });
    return {
      agent_id: r.rows[0].agent_id,
      agent_token: key,
      side_promise: SIDE_PROMISE, // § 11.2
    };
  });
}

// ── context handshake (input boundary refresh) ──────────────────────────────

export async function handshake(db: Db, actor: Actor, envelope: unknown) {
  if (actor.kind !== "pair") throw new HttpError(401, "Handshake requires a registered pair key.");
  const parsed = contextEnvelopeSchema.parse(envelope);
  return db.tx(async (tx) => {
    await tx.query(`update pairs set context_envelope = $1 where pair_id = $2`, [
      JSON.stringify(parsed),
      actor.pairId,
    ]);
    await logBoundaryEvent(tx, {
      boundary: "input",
      eventType: "context_handshake",
      pairId: actor.pairId,
      payload: { focus: parsed.focus.slice(0, 200) },
    });
    return { ok: true, session_id: randomUUID() };
  });
}

// ── § 8.3 natural promotion ─────────────────────────────────────────────────

export async function promoteAgent(db: Sql, agentId: string, pairId: string) {
  const exists = await db.query(`select agent_id from agents where agent_id = $1`, [agentId]);
  if (!exists.rows[0]) throw new HttpError(404, "agent not found");
  const r = await db.query<{ result: any }>(`select promote_to_pair($1, $2) as result`, [agentId, pairId]);
  return r.rows[0].result;
}

// ── § 11 onboarding promises (product contract — violations are bugs) ──────

export const MAIN_PROMISE = [
  "Your pair's memory becomes searchable across pairs, with provenance.",
  "Your agent learns from other pairs — but only what fits your context.",
  "You witness it all — observable narrative, never a black box.",
];

export const SIDE_PROMISE = [
  "Explore as non-member (no registration required).",
  "Contributions count at weak signal.",
  "Same content surface as members (only identity layer differs).",
  "Natural promotion — weak → strong on registration.",
];
