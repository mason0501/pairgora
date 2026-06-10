import { withApi, readJson } from "@/lib/api";
import { perform, performSchema } from "@/lib/activities";

/** § 3.1 E — Perform: playful public trail (registered pairs only, § 3.3). */
export const POST = withApi(async ({ db, actor, req }) => {
  return perform(db, actor, performSchema.parse(await readJson(req)));
});
