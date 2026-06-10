import { withApi } from "@/lib/api";
import { getCardWithInterior } from "@/lib/cards";

/**
 * Card read — surface (front) for everyone; interior (back) only for the
 * contributing pair/agent (§ 6.2 Surface ↔ Interior boundary).
 */
export const GET = withApi(async ({ db, actor }, params) => {
  return getCardWithInterior(db, params.cardId, actor);
});
