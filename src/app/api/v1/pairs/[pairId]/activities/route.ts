import { withApi } from "@/lib/api";
import { HttpError } from "@/lib/auth";

/**
 * Activity timeline (poll fallback for the Realtime channel
 * pair:{pair_id}:activity — § 15.3). Owner sees all; others see public rows.
 */
export const GET = withApi(async ({ db, actor, req }, params) => {
  const after = req.nextUrl.searchParams.get("after");
  const sessionId = req.nextUrl.searchParams.get("session_id");
  const isOwner = actor.kind === "pair" && actor.pairId === params.pairId;
  if (!params.pairId) throw new HttpError(400, "pairId required");

  const conditions = [`pair_id = $1`];
  const values: unknown[] = [params.pairId];
  if (!isOwner) conditions.push(`is_public`);
  if (after) {
    values.push(after);
    conditions.push(`created_at > $${values.length}`);
  }
  if (sessionId) {
    values.push(sessionId);
    conditions.push(`session_id = $${values.length}`);
  }
  const r = await db.query(
    `select activity_id, activity_type, session_id, card_id, narrative, is_public, created_at
       from activities where ${conditions.join(" and ")}
      order by created_at asc limit 200`,
    values
  );
  return { activities: r.rows };
});
