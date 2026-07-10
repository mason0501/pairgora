import { withApi } from "@/lib/api";
import { getCardForViewer } from "@/lib/cards";

/**
 * Card read — surface (front) for everyone; interior (back) masked by viewer
 * tier: observer=front only · member=back core · owner=full (§ 7 masking policy).
 */
export const GET = withApi(async ({ db, actor }, params) => {
  return getCardForViewer(db, params.cardId, actor);
});
