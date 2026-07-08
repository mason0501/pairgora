import { withApi, readJson } from "@/lib/api";
import { recoverKey, recoverKeySchema } from "@/lib/pairs";

/** § 26.2 — re-issue an api_key from a recovery code (recovery-code-only, Mason 7/7). */
export const POST = withApi(async ({ db, req }) => {
  return recoverKey(db, recoverKeySchema.parse(await readJson(req)));
});
