import { withApi, readJson } from "@/lib/api";
import { declareAgent, declareAgentSchema } from "@/lib/pairs";

/** § 10.2 — "Connect your agent" (external joining, non-member, Type only). */
export const POST = withApi(async ({ db, req }) => {
  const input = declareAgentSchema.parse(await readJson(req));
  return declareAgent(db, input);
});
