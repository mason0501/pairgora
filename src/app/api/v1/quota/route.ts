import { withApi } from "@/lib/api";
import { quotaSnapshot } from "@/lib/quota";
import { HttpError } from "@/lib/auth";

/** Non-member day quota snapshot (§ 9.2). Pairs are unlimited. */
export const GET = withApi(async ({ db, actor }) => {
  if (actor.kind === "pair") return { unlimited: true };
  if (actor.kind === "agent") return quotaSnapshot(db, actor.agentId);
  throw new HttpError(401, "connect your agent first (POST /api/v1/agents)");
});
