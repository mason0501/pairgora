import { z } from "zod";

/**
 * Pair Profile 검사 — deterministic scoring (design note 21 § 2–4).
 * Pure rules, zero LLM calls (invariant): same responses → same type,
 * scoring table is public. Response collection is the agent's job
 * (log-based deep form) or the human's (short form); scoring is not.
 *
 * Axis scores live in [-1, +1]: negative → pole A, positive → pole B.
 * Direction, not level — both poles are equal (§ 1.1). "unobserved" is a
 * first-class answer: it dilutes strength toward the unresolved band,
 * which is what prompts a retake as the pair's logs grow (§ 1.3).
 */

export const PROFILE_AXES = [
  // L1 — pair operating contract
  "delegation_breadth", // Scoped ←→ Broad
  "context_handoff", // Minimal ←→ Rich
  "initiative_direction", // Human-led ←→ Agent-led
  "output_absorption", // Full-review ←→ Trust-flow
  "failure_handling", // Intervene ←→ Self-recover
  // L2 — human directionality (direction only, never level)
  "exploration_taste", // Explore ←→ Converge
  "decision_style", // Intuitive ←→ Analytic
  "trust_rhythm", // Fast-trust ←→ Gradual
] as const;
export type ProfileAxis = (typeof PROFILE_AXES)[number];

export type ProfileLayer = "L1" | "L2";
export type ProfilePole = "A" | "B";

export interface AxisSpec {
  axis: ProfileAxis;
  layer: ProfileLayer;
  pole_a: string;
  pole_b: string;
}

export const AXIS_SPECS: Record<ProfileAxis, AxisSpec> = {
  delegation_breadth: { axis: "delegation_breadth", layer: "L1", pole_a: "Scoped", pole_b: "Broad" },
  context_handoff: { axis: "context_handoff", layer: "L1", pole_a: "Minimal", pole_b: "Rich" },
  initiative_direction: { axis: "initiative_direction", layer: "L1", pole_a: "Human-led", pole_b: "Agent-led" },
  output_absorption: { axis: "output_absorption", layer: "L1", pole_a: "Full-review", pole_b: "Trust-flow" },
  failure_handling: { axis: "failure_handling", layer: "L1", pole_a: "Intervene", pole_b: "Self-recover" },
  exploration_taste: { axis: "exploration_taste", layer: "L2", pole_a: "Explore", pole_b: "Converge" },
  decision_style: { axis: "decision_style", layer: "L2", pole_a: "Intuitive", pole_b: "Analytic" },
  trust_rhythm: { axis: "trust_rhythm", layer: "L2", pole_a: "Fast-trust", pole_b: "Gradual" },
};

/** § 3.1 surface type — 4 representative axes → 4-letter code (e.g. B-A-I-F). */
export const REPRESENTATIVE_AXES: ReadonlyArray<{
  axis: ProfileAxis;
  letter_a: string;
  letter_b: string;
}> = [
  { axis: "delegation_breadth", letter_a: "S", letter_b: "B" },
  { axis: "initiative_direction", letter_a: "H", letter_b: "A" },
  { axis: "decision_style", letter_a: "I", letter_b: "N" },
  { axis: "trust_rhythm", letter_a: "F", letter_b: "G" },
];

/**
 * A question is phrased toward one pole of one axis; agreeing pushes the
 * score toward that pole, disagreeing toward the opposite. weight 2 marks
 * core questions (§ 4 rule 1). The catalog lives in profile_questions;
 * archetype names for the 16 codes are a copy task (note 13), not scoring.
 *
 * Formats (Mason 2026-07-24): the agent deep form is binary — log evidence
 * either matches a statement or it doesn't, and unobserved covers thin logs.
 * The human short form is a 5-point Likert — with only ~24 items, graded
 * self-report both feels like a real instrument and recovers resolution
 * the small item count would otherwise lose.
 */
export const QUESTION_FORMATS = ["binary", "likert5"] as const;
export type QuestionFormat = (typeof QUESTION_FORMATS)[number];

export const profileQuestionSchema = z.object({
  question_id: z.string().min(1),
  axis: z.enum(PROFILE_AXES),
  pole: z.enum(["A", "B"]),
  weight: z.union([z.literal(1), z.literal(2)]),
  format: z.enum(QUESTION_FORMATS).default("binary"),
});
export type ProfileQuestion = z.infer<typeof profileQuestionSchema>;
/** Input shape — `format` may be omitted (defaults to "binary"). */
export type ProfileQuestionInput = z.input<typeof profileQuestionSchema>;

export const PROFILE_ANSWERS = [
  "strongly_agree",
  "agree",
  "neutral",
  "disagree",
  "strongly_disagree",
  "unobserved",
] as const;
export type ProfileAnswer = (typeof PROFILE_ANSWERS)[number];

const FORMAT_ANSWERS: Record<QuestionFormat, ReadonlySet<ProfileAnswer>> = {
  binary: new Set<ProfileAnswer>(["agree", "disagree", "unobserved"]),
  likert5: new Set<ProfileAnswer>(PROFILE_ANSWERS),
};

/**
 * Toward-the-question's-pole multiplier in [-1, +1]; null = unobserved
 * (excluded from the numerator, kept in the denominator). Binary agree is a
 * full ±1; Likert plain (dis)agree is a half step, endpoints are full.
 * Neutral is an answer — it holds denominator weight like unobserved, but
 * counts as engagement (answered, completeness).
 */
function answerValue(format: QuestionFormat, answer: ProfileAnswer): number | null {
  switch (answer) {
    case "unobserved": return null;
    case "strongly_agree": return 1;
    case "strongly_disagree": return -1;
    case "neutral": return 0;
    case "agree": return format === "binary" ? 1 : 0.5;
    case "disagree": return format === "binary" ? -1 : -0.5;
  }
}

export const profileResponseSchema = z.object({
  question_id: z.string().min(1),
  answer: z.enum(PROFILE_ANSWERS),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

/** Resolution threshold θ — tuning constant, override from platform_config. */
export const DEFAULT_THETA = 0.2;

export interface AxisResult {
  axis: ProfileAxis;
  layer: ProfileLayer;
  /** [-1, +1]; sign picks the pole, magnitude is strength. */
  score: number;
  strength: number;
  pole: ProfilePole | null;
  /** false = "미결 (관찰 부족)" — retake prompt, not an error state. */
  resolved: boolean;
  answered: number;
  unobserved: number;
  question_count: number;
}

export interface ProfileResult {
  axes: Record<ProfileAxis, AxisResult>;
  /** 4-letter surface code, null while any representative axis is unresolved. */
  type_code: string | null;
  unresolved_axes: ProfileAxis[];
  /** answered weight / presented weight — grows with pair maturity (§ 1.3). */
  completeness: number;
  theta: number;
}

export interface ScoreOpts {
  theta?: number;
}

/**
 * § 4 scoring rules, deterministic end to end:
 *   1. each response contributes ±weight toward its question's pole
 *   2. per-axis Σw normalized by the axis's total presented weight → [-1, +1]
 *   3. representative-axis signs → 4-letter code → archetype lookup (elsewhere)
 *   4. |score| < θ (or nothing answered) = unresolved → retake
 * Unanswered questions count as unobserved: presenting a question the pair
 * cannot answer yet is itself signal, and must pull strength down.
 */
export function scoreProfile(
  questions: ProfileQuestionInput[],
  responses: ProfileResponse[],
  opts: ScoreOpts = {}
): ProfileResult {
  const theta = opts.theta ?? DEFAULT_THETA;

  const byId = new Map<string, ProfileQuestion>();
  for (const q of questions) {
    const parsed = profileQuestionSchema.parse(q);
    if (byId.has(parsed.question_id)) throw new Error(`duplicate question_id: ${parsed.question_id}`);
    byId.set(parsed.question_id, parsed);
  }

  const answerById = new Map<string, ProfileAnswer>();
  for (const r of responses) {
    const parsed = profileResponseSchema.parse(r);
    const q = byId.get(parsed.question_id);
    if (!q) throw new Error(`response to unknown question_id: ${parsed.question_id}`);
    if (answerById.has(parsed.question_id)) throw new Error(`duplicate response for question_id: ${parsed.question_id}`);
    if (!FORMAT_ANSWERS[q.format].has(parsed.answer)) {
      throw new Error(`answer "${parsed.answer}" not allowed for ${q.format} question ${parsed.question_id}`);
    }
    answerById.set(parsed.question_id, parsed.answer);
  }

  const sums = new Map<ProfileAxis, { signed: number; total: number; answered: number; unobserved: number; count: number }>();
  for (const axis of PROFILE_AXES) sums.set(axis, { signed: 0, total: 0, answered: 0, unobserved: 0, count: 0 });

  let answeredWeight = 0;
  let totalWeight = 0;
  for (const q of byId.values()) {
    const s = sums.get(q.axis)!;
    s.count += 1;
    s.total += q.weight;
    totalWeight += q.weight;
    const answer = answerById.get(q.question_id) ?? "unobserved";
    const value = answerValue(q.format, answer);
    if (value === null) {
      s.unobserved += 1;
      continue;
    }
    s.answered += 1;
    answeredWeight += q.weight;
    s.signed += (q.pole === "B" ? value : -value) * q.weight;
  }

  const axes = {} as Record<ProfileAxis, AxisResult>;
  const unresolved: ProfileAxis[] = [];

  for (const axis of PROFILE_AXES) {
    const s = sums.get(axis)!;
    const score = s.total === 0 ? 0 : s.signed / s.total;
    const strength = Math.abs(score);
    const resolved = s.answered > 0 && strength >= theta;
    if (!resolved) unresolved.push(axis);
    axes[axis] = {
      axis,
      layer: AXIS_SPECS[axis].layer,
      score,
      strength,
      pole: resolved ? (score > 0 ? "B" : "A") : null,
      resolved,
      answered: s.answered,
      unobserved: s.unobserved,
      question_count: s.count,
    };
  }

  return {
    axes,
    type_code: typeCodeOf(axes),
    unresolved_axes: unresolved,
    completeness: totalWeight === 0 ? 0 : answeredWeight / totalWeight,
    theta,
  };
}

/** Surface code from the 4 representative axes; null until all 4 resolve. */
export function typeCodeOf(axes: Record<ProfileAxis, AxisResult>): string | null {
  const letters: string[] = [];
  for (const rep of REPRESENTATIVE_AXES) {
    const r = axes[rep.axis];
    if (!r?.resolved || r.pole === null) return null;
    letters.push(r.pole === "A" ? rep.letter_a : rep.letter_b);
  }
  return letters.join("-");
}

/** All 16 surface codes, in representative-axis order (archetype naming key). */
export function allTypeCodes(): string[] {
  let codes: string[] = [""];
  for (const rep of REPRESENTATIVE_AXES) {
    codes = codes.flatMap((c) => [rep.letter_a, rep.letter_b].map((l) => (c ? `${c}-${l}` : l)));
  }
  return codes;
}

export interface ProfileDelta {
  /** observed (agent deep form) score minus self-report (human short form). */
  deltas: Record<ProfileAxis, number>;
  /** axes where both sides resolved to opposite poles — the story anchor (§ 1.2). */
  mismatch_axes: ProfileAxis[];
}

/** Observation ↔ self-report delta — "my agent sees me differently" (§ 1.2). */
export function compareProfiles(observed: ProfileResult, selfReport: ProfileResult): ProfileDelta {
  const deltas = {} as Record<ProfileAxis, number>;
  const mismatch: ProfileAxis[] = [];
  for (const axis of PROFILE_AXES) {
    const o = observed.axes[axis];
    const s = selfReport.axes[axis];
    deltas[axis] = o.score - s.score;
    if (o.resolved && s.resolved && o.pole !== s.pole) mismatch.push(axis);
  }
  return { deltas, mismatch_axes: mismatch };
}
