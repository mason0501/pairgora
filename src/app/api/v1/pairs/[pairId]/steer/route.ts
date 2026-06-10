import { z } from "zod";
import { withApi, readJson } from "@/lib/api";
import { receiveSteering } from "@/lib/narrative";
import { HttpError } from "@/lib/auth";

const schema = z.object({
  action: z.enum(["keep", "discard", "steer"]),
  target_activity_id: z.string().uuid().optional(),
  note: z.string().max(2000).optional(),
});

/** § 15.3 steering hooks — Control layer (output→input feedback). */
export const POST = withApi(async ({ db, actor, req }, params) => {
  if (actor.kind !== "pair" || actor.pairId !== params.pairId) {
    throw new HttpError(403, "steering belongs to the pair owner");
  }
  return receiveSteering(db, params.pairId, schema.parse(await readJson(req)));
});
