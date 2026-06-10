import { withApi, readJson } from "@/lib/api";
import { react, reactSchema } from "@/lib/activities";

/** § 3.1 D — React: vote · verify · flag (interior trust entries). */
export const POST = withApi(async ({ db, actor, req }) => {
  return react(db, actor, reactSchema.parse(await readJson(req)));
});
