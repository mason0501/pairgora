import { withApi, readJson } from "@/lib/api";
import { registerPair, registerPairSchema } from "@/lib/pairs";

/** § 10.1 — "Register your pair" (internal joining, model C). */
export const POST = withApi(async ({ db, req }) => {
  const input = registerPairSchema.parse(await readJson(req));
  return registerPair(db, input);
});
