import { withApi, readJson } from "@/lib/api";
import { store } from "@/lib/activities";

/**
 * § 3.1 B — Store: register a Card (Step 4 cycle close).
 * Paths A (seek_chain) and C (independent) of § 9.1; non-member quota applies.
 */
export const POST = withApi(async ({ db, actor, req }) => {
  return store(db, actor, await readJson(req));
});
