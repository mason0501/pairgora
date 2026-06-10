import { withApi } from "@/lib/api";
import { buildNarrative } from "@/lib/narrative";
import { HttpError } from "@/lib/auth";

/** § 15.3 Step 3 — observable narrative (agent story + timeline + value layers). */
export const GET = withApi(async ({ db, actor, req }, params) => {
  if (actor.kind !== "pair" || actor.pairId !== params.pairId) {
    throw new HttpError(403, "narrative is the pair owner's view — key does not match");
  }
  const sessionId = req.nextUrl.searchParams.get("session_id");
  return buildNarrative(db, params.pairId, sessionId);
});
