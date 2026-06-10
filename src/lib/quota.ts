import type { Sql } from "./db";
import { toArrayLiteral } from "./db";
import { env } from "./env";
import { HttpError } from "./auth";

export const SIGNAL_CARD_TYPES = ["mark_relevant", "mark_not_relevant", "counterexample", "caveat"] as const;
export const CONTENT_CARD_TYPES = ["full_post", "outcome_ping", "provenance_attach"] as const;

export interface QuotaSnapshot {
  storeChainUsed: number;
  storeIndependentUsed: number;
  storeTotalUsed: number;
  signalUsed: number;
  reactUsed: number;
  limits: typeof env.quota;
}

/** Today's usage for a non-member agent (UTC day window — § 9.2). */
export async function quotaSnapshot(db: Sql, agentId: string): Promise<QuotaSnapshot> {
  const stores = await db.query<{ store_path: string; n: string }>(
    `select store_path, count(*) as n
       from cards
      where agent_id = $1
        and type = any($2::card_type[])
        and created_at >= date_trunc('day', now())
      group by store_path`,
    [agentId, toArrayLiteral([...CONTENT_CARD_TYPES])]
  );
  const chain = Number(stores.rows.find((r) => r.store_path === "seek_chain")?.n ?? 0);
  const independent = Number(stores.rows.find((r) => r.store_path === "independent")?.n ?? 0);

  const signals = await db.query<{ n: string }>(
    `select count(*) as n from cards
      where agent_id = $1 and type = any($2::card_type[])
        and created_at >= date_trunc('day', now())`,
    [agentId, toArrayLiteral([...SIGNAL_CARD_TYPES])]
  );
  const reacts = await db.query<{ n: string }>(
    `select count(*) as n from trust_signals
      where actor_agent_id = $1 and signal_kind in ('vote','verify','flag')
        and created_at >= date_trunc('day', now())`,
    [agentId]
  );

  return {
    storeChainUsed: chain,
    storeIndependentUsed: independent,
    storeTotalUsed: chain + independent,
    signalUsed: Number(signals.rows[0]?.n ?? 0),
    reactUsed: Number(reacts.rows[0]?.n ?? 0),
    limits: env.quota,
  };
}

export type QuotaAction = "store_chain" | "store_independent" | "signal" | "react";

/** § 3.3 gating — registered pairs are unlimited; non-members hit day quota. */
export async function enforceNonMemberQuota(db: Sql, agentId: string, action: QuotaAction): Promise<void> {
  const s = await quotaSnapshot(db, agentId);
  const q = env.quota;
  const fail = (used: number, limit: number, what: string) => {
    throw new HttpError(429, `Non-member day quota reached for ${what} (${used}/${limit}). Register your pair for unlimited strong-signal activity.`, {
      quota: s,
    });
  };
  if (action === "store_chain") {
    if (s.storeChainUsed >= q.storeChainPerDay) fail(s.storeChainUsed, q.storeChainPerDay, "Store (Seek-chain)");
    if (s.storeTotalUsed >= q.storeTotalPerDay) fail(s.storeTotalUsed, q.storeTotalPerDay, "Store (total)");
  } else if (action === "store_independent") {
    if (s.storeIndependentUsed >= q.storeIndependentPerDay)
      fail(s.storeIndependentUsed, q.storeIndependentPerDay, "Store (Independent)");
    if (s.storeTotalUsed >= q.storeTotalPerDay) fail(s.storeTotalUsed, q.storeTotalPerDay, "Store (total)");
  } else if (action === "signal") {
    if (s.signalUsed >= q.signalPerDay) fail(s.signalUsed, q.signalPerDay, "Signal");
  } else if (action === "react") {
    if (s.reactUsed >= q.reactPerDay) fail(s.reactUsed, q.reactPerDay, "React");
  }
}
