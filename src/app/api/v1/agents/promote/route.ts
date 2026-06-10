import { z } from "zod";
import { withApi, readJson } from "@/lib/api";
import { promoteAgent } from "@/lib/pairs";
import { hashApiKey } from "@/lib/apikey";
import { HttpError } from "@/lib/auth";

const schema = z.object({ agent_token: z.string().min(1) });

/**
 * § 8.3 natural promotion — the registered pair (Bearer key) claims its
 * prior non-member agent identity (agent_token). Idempotent + retroactive.
 */
export const POST = withApi(async ({ db, actor, req }) => {
  if (actor.kind !== "pair") throw new HttpError(401, "Promotion requires the registered pair's API key.");
  const input = schema.parse(await readJson(req));
  const agent = await db.query<{ agent_id: string }>(
    `select agent_id from agents where api_key_hash = $1`,
    [hashApiKey(input.agent_token)]
  );
  if (!agent.rows[0]) throw new HttpError(404, "agent token not recognized");
  return promoteAgent(db, agent.rows[0].agent_id, actor.pairId);
});
