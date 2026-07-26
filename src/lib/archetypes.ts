/**
 * Pair Profile archetypes — the copy layer over the 16 surface codes
 * (design note 21 § 3.1; approved copy, note 13 — do not edit narratives).
 * Scoring produces the code (profile.ts); this module only names it.
 * Direction, not level: no archetype is rendered as better than another.
 */

export interface Archetype {
  code: string; // e.g. "S-H-I-F"
  name: string; // e.g. "The Sprinter"
  narrative: string;
}

export const ARCHETYPES: readonly Archetype[] = [
  {
    code: "S-H-I-F",
    name: "The Sprinter",
    narrative:
      "Tight briefs, gut calls, instant green lights. This pair ships before other pairs finish writing the ticket.",
  },
  {
    code: "S-H-I-G",
    name: "The Gardener",
    narrative:
      "Small plots, tended by feel, trust grown season by season. Nothing in this pair was rushed — and it shows.",
  },
  {
    code: "S-H-N-F",
    name: "The Surgeon",
    narrative:
      "Precise scope, evidence first, full confidence once the plan is set. Clean cuts, quick closes.",
  },
  {
    code: "S-H-N-G",
    name: "The Craftsman",
    narrative:
      "Every task measured twice, every result inspected, trust earned one flawless piece at a time. Slow is smooth, smooth is masterful.",
  },
  {
    code: "S-A-I-F",
    name: "The Pit Crew",
    narrative:
      "The agent calls the stop, the human waves it in, and four seconds later it's done. Small jobs, split-second trust, zero wasted motion.",
  },
  {
    code: "S-A-I-G",
    name: "The Scout",
    narrative:
      "The agent ranges ahead on instinct and reports back; the human verifies the map before the party moves. Bold eyes, careful feet.",
  },
  {
    code: "S-A-N-F",
    name: "The Navigator",
    narrative:
      "The agent charts the course with data, and the human sails it the same hour. Calculated routes, immediate departures.",
  },
  {
    code: "S-A-N-G",
    name: "The Lab",
    narrative:
      "The agent runs the experiments, one hypothesis at a time — and the human replicates before believing. Peer review is a love language here.",
  },
  {
    code: "B-H-I-F",
    name: "The Catapult",
    narrative:
      "The human aims big on instinct, releases fast, and lets the agent fly the payload. Not every launch lands — the ones that do go far.",
  },
  {
    code: "B-H-I-G",
    name: "The Captain",
    narrative:
      "The human sets the heading by feel and hands over the ship watch by watch. The crew earns the helm; the voyage earns the trust.",
  },
  {
    code: "B-H-N-F",
    name: "The Director",
    narrative:
      "A clear vision, a full production handed to the agent, and fast faith in the dailies. The human doesn't hover — they premiere.",
  },
  {
    code: "B-H-N-G",
    name: "The Conductor",
    narrative:
      "The human holds the score, the agent plays every instrument, and each section rehearses until it's earned its solo. Grand scale, deliberate tempo.",
  },
  {
    code: "B-A-I-F",
    name: "The Autopilot",
    narrative:
      "Broad delegation, agent-led, gut-checked, instantly trusted. The human's job is choosing the destination — the rest already left the runway.",
  },
  {
    code: "B-A-I-G",
    name: "The Explorer",
    narrative:
      "The agent pushes into open territory on its own compass; the human reads the expedition log before funding the next one. Far range, honest maps.",
  },
  {
    code: "B-A-N-F",
    name: "The Operator",
    narrative:
      "The agent runs the whole system by the numbers, and the human reads the dashboard, not the code. Trusted at scale because it's measured at scale.",
  },
  {
    code: "B-A-N-G",
    name: "The Architect",
    narrative:
      "Big structures, agent-drafted, analyzed to the bolt, approved floor by floor. Nothing here was improvised — that's the point.",
  },
];

/**
 * What each letter position in the 4-letter code means — both poles named,
 * neither favored (§ 1.1 direction, not level).
 */
export const TYPE_LETTER_LEGEND: ReadonlyArray<{
  position: number;
  dimension: string;
  a: { letter: string; label: string };
  b: { letter: string; label: string };
  blurb: string;
}> = [
  {
    position: 1,
    dimension: "delegation",
    a: { letter: "S", label: "Scoped" },
    b: { letter: "B", label: "Broad" },
    blurb: "How work is handed over — tight briefs or whole missions.",
  },
  {
    position: 2,
    dimension: "initiative",
    a: { letter: "H", label: "Human-led" },
    b: { letter: "A", label: "Agent-led" },
    blurb: "Who opens the move — the human or the agent.",
  },
  {
    position: 3,
    dimension: "decision",
    a: { letter: "I", label: "Intuitive" },
    b: { letter: "N", label: "Analytic" },
    blurb: "How calls get made — gut or evidence.",
  },
  {
    position: 4,
    dimension: "trust",
    a: { letter: "F", label: "Fast-trust" },
    b: { letter: "G", label: "Gradual" },
    blurb: "How review lets go — quickly or earned over time.",
  },
];

const BY_CODE = new Map(ARCHETYPES.map((a) => [a.code, a]));

/** Archetype for a 4-letter type code (e.g. "B-A-I-F"); null when the code is null/unknown. */
export function archetypeOf(typeCode: string | null | undefined): Archetype | null {
  if (!typeCode) return null;
  return BY_CODE.get(typeCode.trim().toUpperCase()) ?? null;
}
