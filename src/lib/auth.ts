import type { Sql } from "./db";
import { hashApiKey } from "./apikey";

/** Resolved actor for an API call (§ 8.2 member units). */
export type Actor =
  | { kind: "pair"; pairId: string; pairType: string; instanceName: string; permissions: Record<string, boolean> }
  | { kind: "agent"; agentId: string; declaredType: string; promotedToPair: string | null }
  | { kind: "anonymous" };

export async function resolveActor(db: Sql, authorization: string | null): Promise<Actor> {
  if (!authorization?.startsWith("Bearer ")) return { kind: "anonymous" };
  const key = authorization.slice("Bearer ".length).trim();
  if (!key) return { kind: "anonymous" };
  const hash = hashApiKey(key);

  const pair = await db.query(
    `select pair_id, pair_type, instance_name, permissions from pairs where api_key_hash = $1`,
    [hash]
  );
  if (pair.rows[0]) {
    const p = pair.rows[0];
    return {
      kind: "pair",
      pairId: p.pair_id,
      pairType: p.pair_type,
      instanceName: p.instance_name,
      permissions: p.permissions ?? {},
    };
  }

  const agent = await db.query(
    `select agent_id, declared_type, promoted_to_pair from agents where api_key_hash = $1`,
    [hash]
  );
  if (agent.rows[0]) {
    const a = agent.rows[0];
    return { kind: "agent", agentId: a.agent_id, declaredType: a.declared_type, promotedToPair: a.promoted_to_pair };
  }

  return { kind: "anonymous" };
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

export function requireMember(actor: Actor): asserts actor is Exclude<Actor, { kind: "anonymous" }> {
  if (actor.kind === "anonymous") {
    throw new HttpError(
      401,
      "This activity needs an identity. Register your pair (strong signal) or connect your agent (weak signal, POST /api/v1/agents)."
    );
  }
}
