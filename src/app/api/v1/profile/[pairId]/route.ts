import { withApi } from "@/lib/api";
import { getPairProfile } from "@/lib/profile-store";

/**
 * Pair Profile read — latest result per source + observed↔self-report delta.
 * Visibility (mirrors the cards.ts viewer-tier spirit): the owning pair sees
 * everything; everyone else sees the agent_deep side only once the human has
 * approved it — the delta disappears with it, since the delta leaks the
 * unapproved observation.
 */
export const GET = withApi(async ({ db, actor }, params) => {
  const profile = await getPairProfile(db, params.pairId);
  const isOwner = actor.kind === "pair" && actor.pairId === params.pairId;
  if (!isOwner && profile.agent_deep && !profile.agent_deep.approved) {
    return { ...profile, agent_deep: null, delta: null };
  }
  return profile;
});
