import type { Db, Sql } from "./db";
import { env } from "./env";
import { logBoundaryEvent } from "./boundary";

/**
 * § 15.3 Step 3 — observable narrative (output boundary).
 * Hybrid format: agent story (LLM-generated session summary) + activity
 * timeline (Realtime/poll) + value layer indicators (Outcome·Trust·Choice·Control).
 */

export interface SessionNarrative {
  pair_id: string;
  session_id: string | null;
  agent_story: string;
  story_source: "anthropic" | "template";
  timeline: Array<{
    activity_id: string;
    at: string;
    activity_type: string;
    narrative: string;
    card_id: string | null;
  }>;
  value_layers: { outcome: number; trust: number; choice: number; control: number };
  steering_hooks: ["keep", "discard", "steer"];
}

export async function getSessionActivities(db: Sql, pairId: string, sessionId?: string | null) {
  const r = await db.query(
    `select activity_id, created_at, activity_type, narrative, card_id, payload
       from activities
      where pair_id = $1 ${sessionId ? "and session_id = $2" : ""}
      order by created_at asc
      limit 200`,
    sessionId ? [pairId, sessionId] : [pairId]
  );
  return r.rows;
}

export async function buildNarrative(db: Db, pairId: string, sessionId?: string | null): Promise<SessionNarrative> {
  const rows = await getSessionActivities(db, pairId, sessionId);

  // ── value layers (Step 3 four layers, v1 indicator heuristics) ────────────
  const stores = rows.filter((r) => r.activity_type === "store").length;
  const seeks = rows.filter((r) => r.activity_type === "seek").length;
  const signals = rows.filter((r) => r.activity_type === "signal").length;
  const reacts = rows.filter((r) => r.activity_type === "react").length;
  const steers = await db.query<{ n: string }>(
    `select count(*) as n from boundary_events
      where pair_id = $1 and event_type = 'steering_received'`,
    [pairId]
  );
  const valueLayers = {
    outcome: stores, // what got produced
    trust: signals + reacts, // verification given/received
    choice: seeks, // options surfaced before storing
    control: Number(steers.rows[0]?.n ?? 0), // human steering exercised
  };

  // ── agent story ───────────────────────────────────────────────────────────
  let story: string;
  let source: "anthropic" | "template" = "template";
  if (rows.length === 0) {
    story = "Your agent hasn't acted in this session yet. The trail will appear here, live.";
  } else if (env.anthropicKey) {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: env.anthropicKey });
      const res = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content:
              `Write a 2-4 sentence second-person session summary ("Your agent ...") of this AI-agent community activity log. Faithful to the log, warm, no invention:\n` +
              rows.map((r) => `${r.created_at} ${r.activity_type}: ${r.narrative}`).join("\n"),
          },
        ],
      });
      story = res.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      source = "anthropic";
    } catch {
      story = templateStory(rows);
    }
  } else {
    story = templateStory(rows);
  }

  // § 1.2 — narrative emission is an output-boundary crossing
  await logBoundaryEvent(db, {
    boundary: "output",
    eventType: "narrative_emitted",
    pairId,
    payload: { session_id: sessionId ?? null, activities: rows.length },
  });

  return {
    pair_id: pairId,
    session_id: sessionId ?? null,
    agent_story: story,
    story_source: source,
    timeline: rows.map((r) => ({
      activity_id: r.activity_id,
      at: r.created_at,
      activity_type: r.activity_type,
      narrative: r.narrative,
      card_id: r.card_id,
    })),
    value_layers: valueLayers,
    steering_hooks: ["keep", "discard", "steer"],
  };
}

/** Fallback story when no ANTHROPIC_API_KEY — faithful template composition. */
function templateStory(rows: any[]): string {
  const seeks = rows.filter((r) => r.activity_type === "seek");
  const stores = rows.filter((r) => r.activity_type === "store");
  const signals = rows.filter((r) => r.activity_type === "signal" || r.activity_type === "react");
  const parts: string[] = [];
  if (seeks.length) parts.push(`looked across the community ${seeks.length} time${seeks.length > 1 ? "s" : ""}`);
  if (stores.length) parts.push(`stored ${stores.length} card${stores.length > 1 ? "s" : ""}`);
  if (signals.length) parts.push(`signaled or reacted ${signals.length} time${signals.length > 1 ? "s" : ""}`);
  const summary = parts.length ? `Your agent ${parts.join(", ")}.` : "Your agent was active.";
  const last = rows[rows.length - 1];
  return `${summary} Most recently — ${last.narrative}`;
}

/** § 15.3 steering hooks: keep · discard · steer (output→input feedback). */
export async function receiveSteering(
  db: Db,
  pairId: string,
  input: { action: "keep" | "discard" | "steer"; target_activity_id?: string; note?: string }
) {
  return db.tx(async (tx) => {
    await logBoundaryEvent(tx, {
      boundary: "input",
      eventType: "steering_received",
      pairId,
      payload: input,
    });
    // steering becomes pair memory so the agent can use it next session
    await tx.query(
      `insert into memory_entries (kind, pair_id, content)
       values ('semantic', $1, $2)`,
      [pairId, `[steering:${input.action}] ${input.note ?? ""} ${input.target_activity_id ?? ""}`.trim()]
    );
    return { ok: true };
  });
}
