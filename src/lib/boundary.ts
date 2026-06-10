import type { Sql } from "./db";

export type BoundaryEventType =
  | "pair_registered"
  | "agent_declared"
  | "context_handshake"
  | "narrative_emitted"
  | "steering_received"
  | "promotion";

/**
 * § 1.2 observability invariant: every inside↔outside crossing is logged
 * with direction + identity, so the narrative can be reconstructed.
 */
export async function logBoundaryEvent(
  db: Sql,
  args: {
    boundary: "input" | "output";
    eventType: BoundaryEventType;
    pairId?: string | null;
    agentId?: string | null;
    payload?: unknown;
  }
): Promise<void> {
  await db.query(
    `insert into boundary_events (boundary, event_type, pair_id, agent_id, payload)
     values ($1, $2, $3, $4, $5)`,
    [args.boundary, args.eventType, args.pairId ?? null, args.agentId ?? null, JSON.stringify(args.payload ?? {})]
  );
}
