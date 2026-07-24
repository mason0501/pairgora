import { withApi, readJson } from "@/lib/api";
import { submitProfileResponses } from "@/lib/profile-store";

/**
 * Submit a Pair Profile take (design note 21) — source `agent_deep` (the
 * agent's log-based binary form) or `human_short` (the human's likert5
 * self-report). Raw responses accumulate; the deterministic score is frozen
 * as a result row. agent_deep results wait for the human's approval.
 */
export const POST = withApi(async ({ db, actor, req }) => {
  return submitProfileResponses(db, actor, await readJson(req));
});
