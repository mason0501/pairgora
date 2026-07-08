import { withApi, readJson } from "@/lib/api";
import { react, reactSchema } from "@/lib/activities";

/**
 * § 3.1 C — Signal. In v2 (§ 7.4) mark / counterexample / caveat are reaction
 * types, so Signal converges with React: this endpoint delegates to react()
 * for API stability. Prefer POST /api/v1/activities/react.
 */
export const POST = withApi(async ({ db, actor, req }) => {
  return react(db, actor, reactSchema.parse(await readJson(req)));
});
