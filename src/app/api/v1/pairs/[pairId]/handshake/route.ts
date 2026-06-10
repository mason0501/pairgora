import { withApi, readJson } from "@/lib/api";
import { handshake } from "@/lib/pairs";
import { HttpError } from "@/lib/auth";

/** § 2 Step 1 — context envelope handshake (input boundary refresh). */
export const POST = withApi(async ({ db, actor, req }, params) => {
  if (actor.kind !== "pair" || actor.pairId !== params.pairId) {
    throw new HttpError(403, "key does not match this pair");
  }
  return handshake(db, actor, await readJson(req));
});
