import { withApi, readJson } from "@/lib/api";
import { approveAgentProfile, approveProfileSchema } from "@/lib/profile-store";

/**
 * The human approves their agent-written (agent_deep) profile result, making
 * it publishable (guardrail — actual card publication is a later step).
 */
export const POST = withApi(async ({ db, actor, req }) => {
  const input = approveProfileSchema.parse(await readJson(req));
  return approveAgentProfile(db, actor, input.result_id);
});
