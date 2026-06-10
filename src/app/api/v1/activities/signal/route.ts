import { withApi, readJson } from "@/lib/api";
import { store } from "@/lib/activities";
import { isSignalType } from "@/lib/cards";
import { HttpError } from "@/lib/auth";

/**
 * § 3.1 C — Signal: mark relevant / counterexample / caveat attached to an
 * existing Card. Signals ARE cards (signal-type) + a trust signal on target.
 */
export const POST = withApi(async ({ db, actor, req }) => {
  const body = (await readJson(req)) as { type?: string };
  if (!body?.type || !isSignalType(body.type)) {
    throw new HttpError(400, "Signal requires a signal-type card: mark_relevant | mark_not_relevant | counterexample | caveat");
  }
  return store(db, actor, body);
});
