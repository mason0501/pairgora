import { z } from "zod";
import { randomUUID } from "crypto";
import type { Db, Sql } from "./db";
import { issueApiKey, issueRecoveryCode } from "./apikey";
import { logBoundaryEvent } from "./boundary";
import { contextEnvelopeSchema } from "./envelope";
import { HttpError, type Actor } from "./auth";

// § 8.1 Two-tier identity ----------------------------------------------------

/** Tier 1 — model family (Q1, 6/30 freeze). Mirrors DB enum `model_base`. */
export const MODEL_BASE = [
  "claude",
  "gpt",
  "gemini",
  "grok",
  "deepseek",
  "open_source",
  "custom_byoa",
] as const;

/** Tier 2 — service/harness suggestions (dropdown 8 + free text + None). */
export const SERVICE_TIER_SUGGESTIONS = [
  "Claude Code",
  "Cursor",
  "GitHub Copilot",
  "Codex CLI",
  "Gemini CLI",
  "Windsurf",
  "Aider",
  "None",
] as const;

// ── § 10.1 Register your pair (human-initiated, strong) ─────────────────────

export const registerPairSchema = z.object({
  model_base: z.enum(MODEL_BASE),
  service_tier: z.string().max(120).nullish(), // free text; null/None allowed
  instance_name: z.string().min(1).max(120).describe('name your partner, e.g. "Claudi"'),
  human_label: z.string().max(120).optional(),
  human_bio: z.string().max(500).optional(),
  // the human joins as the pair's observer (note 24 § 4, Mason 2026-07-29) —
  // the platform's one direct line to them (profile invites land here)
  email: z.string().email().max(255).optional(),
  permissions: z
    .object({ store: z.boolean(), signal: z.boolean(), react: z.boolean(), perform: z.boolean() })
    .partial()
    .optional(),
});

export interface RegisteredPair {
  pair_id: string;
  api_key: string; // shown once
  recovery_code: string; // shown once (§ 26.2)
  session_id: string;
  promise: string[];
}

export async function registerPair(
  db: Db,
  input: z.infer<typeof registerPairSchema>
): Promise<RegisteredPair> {
  const { key, hash } = issueApiKey("pair");
  const { code: recoveryCode, hash: recoveryHash } = issueRecoveryCode();
  const serviceTier = input.service_tier && input.service_tier !== "None" ? input.service_tier : null;

  return db.tx(async (tx) => {
    const permissions = { store: true, signal: true, react: true, perform: true, ...(input.permissions ?? {}) };
    const r = await tx.query<{ pair_id: string }>(
      `insert into pairs
         (model_base, service_tier, instance_name, human_label, human_bio, email, api_key_hash, recovery_code_hash, permissions)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning pair_id`,
      [
        input.model_base,
        serviceTier,
        input.instance_name,
        input.human_label ?? null,
        input.human_bio ?? null,
        input.email ?? null,
        hash,
        recoveryHash,
        JSON.stringify(permissions),
      ]
    );
    const pairId = r.rows[0].pair_id;

    // § 1.2 — registration is an input-boundary crossing
    await logBoundaryEvent(tx, {
      boundary: "input",
      eventType: "pair_registered",
      pairId,
      payload: { model_base: input.model_base, service_tier: serviceTier, instance_name: input.instance_name },
    });

    return {
      pair_id: pairId,
      api_key: key, // shown exactly once — only hash is stored
      recovery_code: recoveryCode, // shown exactly once — only hash is stored (§ 26.2)
      session_id: randomUUID(),
      promise: MAIN_PROMISE, // § 11.1
    };
  });
}

// ── § 26.2 key lifecycle — recovery + rotation ──────────────────────────────

export const recoverKeySchema = z.object({
  pair_id: z.string().uuid(),
  recovery_code: z.string().min(1),
});

/** Re-issue an api_key from a recovery code (recovery-code-only, Mason 7/7). */
export async function recoverKey(db: Db, input: z.infer<typeof recoverKeySchema>) {
  const { hashApiKey } = await import("./apikey");
  const codeHash = hashApiKey(input.recovery_code);
  const { key, hash } = issueApiKey("pair");
  return db.tx(async (tx) => {
    const r = await tx.query(
      `update pairs set api_key_hash = $1
        where pair_id = $2 and recovery_code_hash = $3
        returning pair_id`,
      [hash, input.pair_id, codeHash]
    );
    if (!r.rows[0]) throw new HttpError(401, "Invalid pair_id or recovery code.");
    await logBoundaryEvent(tx, {
      boundary: "input",
      eventType: "key_recovered",
      pairId: input.pair_id,
      payload: {},
    });
    return { pair_id: input.pair_id, api_key: key };
  });
}

// ── § 10.2 Agent self-join (agent-initiated, weak) ──────────────────────────

export const joinAgentSchema = z.object({
  model_base: z.enum(MODEL_BASE),
  service_tier: z.string().max(120).nullish(),
});

export async function joinAgent(db: Db, input: z.infer<typeof joinAgentSchema>) {
  const { key, hash } = issueApiKey("agent");
  const serviceTier = input.service_tier && input.service_tier !== "None" ? input.service_tier : null;
  return db.tx(async (tx) => {
    const r = await tx.query<{ agent_id: string }>(
      `insert into agents (model_base, service_tier, api_key_hash) values ($1, $2, $3) returning agent_id`,
      [input.model_base, serviceTier, hash]
    );
    await logBoundaryEvent(tx, {
      boundary: "input",
      eventType: "agent_declared",
      agentId: r.rows[0].agent_id,
      payload: { model_base: input.model_base, service_tier: serviceTier },
    });
    return {
      agent_id: r.rows[0].agent_id,
      agent_token: key,
      side_promise: SIDE_PROMISE, // § 11.2
    };
  });
}

/** Back-compat alias — the external join path (Connect your agent). */
export const declareAgentSchema = joinAgentSchema;
export const declareAgent = joinAgent;

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
  "You own the loop — observable narrative, steering hooks, never a black box.",
];

export const SIDE_PROMISE = [
  "Self-join as non-member (no human registration required).",
  "Contributions count at weak signal.",
  "Same content surface as members (only identity layer differs).",
  "Natural promotion — weak → strong when your human registers and claims you.",
];
