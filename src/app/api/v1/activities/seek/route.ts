import { withApi, readJson } from "@/lib/api";
import { seek, seekSchema } from "@/lib/activities";

/** § 3.1 A — Seek (pair-context-as-query). Unlimited for all member units. */
export const POST = withApi(async ({ db, actor, req }) => {
  return seek(db, actor, seekSchema.parse(await readJson(req)));
});
