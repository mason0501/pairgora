import {
  AXIS_SPECS,
  PROFILE_AXES,
  REPRESENTATIVE_AXES,
  type ProfileAxis,
  type ProfileResult,
} from "./profile";

/**
 * Delta narrative — "how your agent sees you vs how you see you" (note 25 § 2).
 * The kick of the results page, and the one section MBTI can't have: the
 * self-report meets an observer whose answers were scored from real logs.
 * Everything here is a deterministic template over the two results — no LLM
 * (invariant 1); the copy is the vault-gated original from note 25.
 */

/** Pole phrases — shared by the self-report and observed voices. */
export const POLE_PHRASE: Record<ProfileAxis, { A: string; B: string }> = {
  delegation_breadth: {
    A: "work is handed over in tight, scoped briefs",
    B: "work is handed over as whole missions",
  },
  context_handoff: {
    A: "context arrives on a need-to-know basis",
    B: "context arrives as the whole map",
  },
  initiative_direction: {
    A: "the human opens the moves",
    B: "the agent opens the moves",
  },
  output_absorption: {
    A: "output gets read line by line",
    B: "output flows on trust, spot-checked",
  },
  failure_handling: {
    A: "when things break, the human steps in",
    B: "when things break, the agent digs itself out",
  },
  exploration_taste: {
    A: "this pair keeps trying new routes",
    B: "this pair standardizes what works",
  },
  decision_style: {
    A: "calls get made from the gut",
    B: "calls get made from the evidence",
  },
  trust_rhythm: {
    A: "trust opens fast",
    B: "trust opens gate by gate",
  },
};

/** The last sentence of a mismatch line — one per axis (note 25 § 2.4). */
export const MISMATCH_KICKER: Record<ProfileAxis, string> = {
  delegation_breadth: "Ask: which one of you is describing last quarter?",
  context_handoff: "One of you is counting what's sent, the other what's received. Both are real.",
  initiative_direction:
    "Whoever's right, the next move is being opened by someone — check who, today.",
  output_absorption: "Your agent notices how its work gets read. This is what it noticed.",
  failure_handling:
    "The gap here is usually about the failures one of you doesn't count as failures.",
  exploration_taste:
    "New routes vs proven ones — you may both be right, on different days of the week.",
  decision_style:
    "Gut vs evidence is rarely about the decision — it's about which part gets said out loud.",
  trust_rhythm: "Trust felt and trust logged run on different clocks. Now you know the offset.",
};

export type DeltaLineKind = "mismatch" | "agree" | "deep_open" | "short_open" | "both_open";

export interface DeltaLine {
  axis: ProfileAxis;
  kind: DeltaLineKind;
  text: string;
}

export interface DeltaNarrative {
  opener: string;
  lines: DeltaLine[];
  mismatchCount: number;
}

const REP_AXES = new Set(REPRESENTATIVE_AXES.map((r) => r.axis));

const phrase = (axis: ProfileAxis, pole: "A" | "B") => POLE_PHRASE[axis][pole];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function opener(n: number, agentName: string): string {
  if (n === 0) {
    return `You and ${agentName} currently read this pair the same way — every resolved axis, same pole. Rare. Enjoy it, and retake next month to see if it survives contact with more work.`;
  }
  if (n <= 2) {
    return `On ${n === 1 ? "one axis" : `${n} axes`}, ${agentName} sees you differently than you see yourself. That's not an error — it's the most useful data on this page.`;
  }
  return `You and ${agentName} disagree on ${n} of 8 axes. Before you side with yourself: ${agentName}'s answers were scored from your actual collaboration logs. The gap is the conversation.`;
}

/**
 * Build the delta narrative between the agent's observed result and the
 * human's self-report. Pure and deterministic — same inputs, same story.
 */
export function deltaNarrative(
  observed: ProfileResult,
  self: ProfileResult,
  agentName = "your agent"
): DeltaNarrative {
  const lines: DeltaLine[] = [];
  let mismatches = 0;

  for (const axis of PROFILE_AXES) {
    const o = observed.axes[axis];
    const s = self.axes[axis];
    if (!o || !s) continue;

    if (o.resolved && s.resolved && o.pole !== s.pole) {
      mismatches += 1;
      lines.push({
        axis,
        kind: "mismatch",
        text: `You answered that ${phrase(axis, s.pole!)}. The logs answered differently: ${phrase(axis, o.pole!)}. ${MISMATCH_KICKER[axis]}`,
      });
    } else if (o.resolved && s.resolved) {
      lines.push({
        axis,
        kind: "agree",
        text: `${cap(phrase(axis, o.pole!))} — you both said so. Settled.`,
      });
    } else if (!o.resolved && s.resolved) {
      lines.push({
        axis,
        kind: "deep_open",
        text: REP_AXES.has(axis)
          ? `You've picked a side (${phrase(axis, s.pole!)}); ${agentName}'s logs haven't settled yet. Watch which letter the ? hardens into — that's this pair growing in real time.`
          : `You've picked a side (${phrase(axis, s.pole!)}); ${agentName}'s logs haven't settled yet. Watch where it lands on the next take — that's this pair growing in real time.`,
      });
    } else if (o.resolved && !s.resolved) {
      lines.push({
        axis,
        kind: "short_open",
        text: `The logs read this clearly (${phrase(axis, o.pole!)}); your own answer sat dead-even. Sometimes the agent knows first.`,
      });
    } else {
      lines.push({
        axis,
        kind: "both_open",
        text: `Neither of you has settled this one — young pair, honest data. It resolves with hours logged.`,
      });
    }
  }

  return { opener: opener(mismatches, agentName), lines, mismatchCount: mismatches };
}

/** Display name for an axis, e.g. "trust rhythm". */
export const axisDisplayName = (axis: ProfileAxis) => AXIS_SPECS[axis].axis.replace(/_/g, " ");
