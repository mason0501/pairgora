import { describe, it, expect } from "vitest";
import {
  PROFILE_AXES,
  AXIS_SPECS,
  REPRESENTATIVE_AXES,
  DEFAULT_THETA,
  scoreProfile,
  allTypeCodes,
  compareProfiles,
  type ProfileAxis,
  type ProfileQuestionInput,
  type ProfileResponse,
} from "@/lib/profile";

/** n questions on one axis, ids `${axis}-1..n`, phrased toward `pole`. */
function axisQuestions(axis: ProfileAxis, n: number, pole: "A" | "B" = "B", weight: 1 | 2 = 1): ProfileQuestionInput[] {
  return Array.from({ length: n }, (_, i) => ({ question_id: `${axis}-${i + 1}`, axis, pole, weight }));
}

function answerAll(questions: ProfileQuestionInput[], answer: ProfileResponse["answer"]): ProfileResponse[] {
  return questions.map((q) => ({ question_id: q.question_id, answer }));
}

/** Quick-form catalog: 3 questions per representative axis. */
function quickForm(): ProfileQuestionInput[] {
  return REPRESENTATIVE_AXES.flatMap((rep) => axisQuestions(rep.axis, 3));
}

/** Likert short-form catalog: n questions on one axis toward `pole`. */
function likertQuestions(axis: ProfileAxis, n: number, pole: "A" | "B" = "B"): ProfileQuestionInput[] {
  return axisQuestions(axis, n, pole).map((q) => ({ ...q, format: "likert5" as const }));
}

// ── axis system (§ 2) ───────────────────────────────────────────────────────

describe("axis system (§ 2)", () => {
  it("has 8 axes — 5 L1 (pair contract) + 3 L2 (human direction)", () => {
    expect(PROFILE_AXES).toHaveLength(8);
    const layers = PROFILE_AXES.map((a) => AXIS_SPECS[a].layer);
    expect(layers.filter((l) => l === "L1")).toHaveLength(5);
    expect(layers.filter((l) => l === "L2")).toHaveLength(3);
  });

  it("has 4 representative axes producing 16 distinct surface codes", () => {
    expect(REPRESENTATIVE_AXES).toHaveLength(4);
    const codes = allTypeCodes();
    expect(codes).toHaveLength(16);
    expect(new Set(codes).size).toBe(16);
    expect(codes).toContain("B-A-I-F");
    expect(codes).toContain("S-H-N-G");
  });
});

// ── deterministic scoring (§ 4) ─────────────────────────────────────────────

describe("scoreProfile — deterministic rules (§ 4)", () => {
  it("agree toward pole B scores positive and resolves to B", () => {
    const qs = axisQuestions("delegation_breadth", 4, "B");
    const r = scoreProfile(qs, answerAll(qs, "agree"));
    const axis = r.axes.delegation_breadth;
    expect(axis.score).toBe(1);
    expect(axis.pole).toBe("B");
    expect(axis.resolved).toBe(true);
  });

  it("disagree flips to the opposite pole with equal weight", () => {
    const qs = axisQuestions("delegation_breadth", 4, "B");
    const r = scoreProfile(qs, answerAll(qs, "disagree"));
    expect(r.axes.delegation_breadth.score).toBe(-1);
    expect(r.axes.delegation_breadth.pole).toBe("A");
  });

  it("questions phrased toward pole A score negative on agree (balanced pools)", () => {
    const qs = axisQuestions("context_handoff", 2, "A");
    const r = scoreProfile(qs, answerAll(qs, "agree"));
    expect(r.axes.context_handoff.pole).toBe("A");
    expect(r.axes.context_handoff.score).toBe(-1);
  });

  it("core questions (weight 2) count double", () => {
    const qs: ProfileQuestionInput[] = [
      { question_id: "q1", axis: "trust_rhythm", pole: "B", weight: 2 },
      { question_id: "q2", axis: "trust_rhythm", pole: "B", weight: 1 },
    ];
    const r = scoreProfile(qs, [
      { question_id: "q1", answer: "agree" },
      { question_id: "q2", answer: "disagree" },
    ]);
    // (+2 - 1) / 3
    expect(r.axes.trust_rhythm.score).toBeCloseTo(1 / 3);
    expect(r.axes.trust_rhythm.pole).toBe("B");
  });

  it("mixed answers cancel out — |score| < θ means unresolved, not an error", () => {
    const qs = axisQuestions("failure_handling", 4, "B");
    const r = scoreProfile(qs, [
      { question_id: "failure_handling-1", answer: "agree" },
      { question_id: "failure_handling-2", answer: "disagree" },
      { question_id: "failure_handling-3", answer: "agree" },
      { question_id: "failure_handling-4", answer: "disagree" },
    ]);
    expect(r.axes.failure_handling.score).toBe(0);
    expect(r.axes.failure_handling.resolved).toBe(false);
    expect(r.axes.failure_handling.pole).toBeNull();
    expect(r.unresolved_axes).toContain("failure_handling");
  });

  it("is deterministic — response order does not change the result", () => {
    const qs = quickForm();
    const responses = qs.map((q, i) => ({
      question_id: q.question_id,
      answer: (i % 3 === 0 ? "disagree" : "agree") as ProfileResponse["answer"],
    }));
    const a = scoreProfile(qs, responses);
    const b = scoreProfile([...qs].reverse(), [...responses].reverse());
    expect(b).toEqual(a);
  });
});

// ── unobserved as first-class answer (§ 1.3) ────────────────────────────────

describe("unobserved — thin logs dilute strength toward retake (§ 1.3)", () => {
  it("unobserved answers keep denominator weight, pulling strength down", () => {
    const qs = axisQuestions("exploration_taste", 10, "B");
    const responses: ProfileResponse[] = [
      { question_id: "exploration_taste-1", answer: "agree" },
      ...qs.slice(1).map((q) => ({ question_id: q.question_id, answer: "unobserved" as const })),
    ];
    const r = scoreProfile(qs, responses);
    const axis = r.axes.exploration_taste;
    expect(axis.score).toBeCloseTo(0.1);
    expect(axis.resolved).toBe(false); // 0.1 < DEFAULT_THETA 0.2
    expect(axis.unobserved).toBe(9);
    expect(axis.answered).toBe(1);
  });

  it("missing responses count as unobserved — presenting unanswerable questions is signal", () => {
    const qs = axisQuestions("decision_style", 5, "B");
    const r = scoreProfile(qs, [{ question_id: "decision_style-1", answer: "agree" }]);
    expect(r.axes.decision_style.unobserved).toBe(4);
    expect(r.axes.decision_style.score).toBeCloseTo(0.2);
  });

  it("an axis with zero answered questions is unresolved even at θ=0", () => {
    const qs = axisQuestions("trust_rhythm", 3, "B");
    const r = scoreProfile(qs, answerAll(qs, "unobserved"), { theta: 0 });
    expect(r.axes.trust_rhythm.resolved).toBe(false);
    expect(r.axes.trust_rhythm.pole).toBeNull();
  });

  it("completeness = answered weight / presented weight (∝ pair maturity)", () => {
    const qs = [...axisQuestions("delegation_breadth", 2), ...axisQuestions("context_handoff", 2)];
    const r = scoreProfile(qs, [
      { question_id: "delegation_breadth-1", answer: "agree" },
      { question_id: "delegation_breadth-2", answer: "disagree" },
      { question_id: "context_handoff-1", answer: "unobserved" },
    ]);
    expect(r.completeness).toBe(0.5);
  });
});

// ── likert5 — human short form (Mason 2026-07-24) ───────────────────────────

describe("likert5 — human short form", () => {
  it("endpoints score full ±1, plain agree/disagree half", () => {
    const qs = likertQuestions("delegation_breadth", 4);
    const r = scoreProfile(qs, [
      { question_id: "delegation_breadth-1", answer: "strongly_agree" }, // +1
      { question_id: "delegation_breadth-2", answer: "agree" }, // +0.5
      { question_id: "delegation_breadth-3", answer: "disagree" }, // -0.5
      { question_id: "delegation_breadth-4", answer: "strongly_disagree" }, // -1
    ]);
    expect(r.axes.delegation_breadth.score).toBe(0);

    const strong = scoreProfile(qs, answerAll(qs, "strongly_agree"));
    expect(strong.axes.delegation_breadth.score).toBe(1);
    const mild = scoreProfile(qs, answerAll(qs, "agree"));
    expect(mild.axes.delegation_breadth.score).toBe(0.5);
    expect(mild.axes.delegation_breadth.pole).toBe("B");
  });

  it("neutral counts as answered (completeness) but holds weight in the denominator", () => {
    const qs = likertQuestions("decision_style", 4);
    const r = scoreProfile(qs, [
      { question_id: "decision_style-1", answer: "strongly_agree" },
      { question_id: "decision_style-2", answer: "neutral" },
      { question_id: "decision_style-3", answer: "neutral" },
      { question_id: "decision_style-4", answer: "neutral" },
    ]);
    expect(r.axes.decision_style.score).toBe(0.25);
    expect(r.axes.decision_style.answered).toBe(4);
    expect(r.axes.decision_style.unobserved).toBe(0);
    expect(r.completeness).toBe(1);
  });

  it("a fully neutral human lands unresolved — no pole guessing", () => {
    const qs = likertQuestions("trust_rhythm", 3);
    const r = scoreProfile(qs, answerAll(qs, "neutral"));
    expect(r.axes.trust_rhythm.resolved).toBe(false);
    expect(r.axes.trust_rhythm.pole).toBeNull();
  });

  it("binary questions reject likert-only answers", () => {
    const qs = axisQuestions("delegation_breadth", 1);
    expect(() => scoreProfile(qs, [{ question_id: "delegation_breadth-1", answer: "strongly_agree" }]))
      .toThrow(/not allowed for binary/);
    expect(() => scoreProfile(qs, [{ question_id: "delegation_breadth-1", answer: "neutral" }]))
      .toThrow(/not allowed for binary/);
  });

  it("likert questions accept unobserved (skip) like the deep form", () => {
    const qs = likertQuestions("exploration_taste", 2);
    const r = scoreProfile(qs, [
      { question_id: "exploration_taste-1", answer: "strongly_agree" },
      { question_id: "exploration_taste-2", answer: "unobserved" },
    ]);
    expect(r.axes.exploration_taste.score).toBe(0.5);
    expect(r.axes.exploration_taste.unobserved).toBe(1);
    expect(r.completeness).toBe(0.5);
  });
});

// ── threshold θ (§ 4 rule 4) ────────────────────────────────────────────────

describe("threshold θ — tuning constant", () => {
  it("resolves at exactly θ, stays unresolved just below", () => {
    const qs = axisQuestions("output_absorption", 10, "B");
    const twoOfTen = scoreProfile(qs, [
      { question_id: "output_absorption-1", answer: "agree" },
      { question_id: "output_absorption-2", answer: "agree" },
    ]);
    expect(twoOfTen.axes.output_absorption.score).toBeCloseTo(DEFAULT_THETA);
    expect(twoOfTen.axes.output_absorption.resolved).toBe(true);

    const oneOfTen = scoreProfile(qs, [{ question_id: "output_absorption-1", answer: "agree" }]);
    expect(oneOfTen.axes.output_absorption.resolved).toBe(false);
  });

  it("θ is overridable (platform_config tuning)", () => {
    const qs = axisQuestions("output_absorption", 10, "B");
    const responses: ProfileResponse[] = [
      { question_id: "output_absorption-1", answer: "agree" },
      { question_id: "output_absorption-2", answer: "agree" },
      { question_id: "output_absorption-3", answer: "agree" },
    ];
    expect(scoreProfile(qs, responses, { theta: 0.5 }).axes.output_absorption.resolved).toBe(false);
    expect(scoreProfile(qs, responses, { theta: 0.3 }).axes.output_absorption.resolved).toBe(true);
    expect(scoreProfile(qs, responses).theta).toBe(DEFAULT_THETA);
  });
});

// ── surface type code (§ 3.1) ───────────────────────────────────────────────

describe("type code — 4 representative axes (§ 3.1)", () => {
  it("quick form with clear answers yields a full 4-letter code", () => {
    const qs = quickForm();
    // delegation → agree(B), initiative → disagree(H), decision → agree(N), trust → disagree(F)
    const responses = qs.map((q) => ({
      question_id: q.question_id,
      answer: (q.axis === "initiative_direction" || q.axis === "trust_rhythm" ? "disagree" : "agree") as ProfileResponse["answer"],
    }));
    const r = scoreProfile(qs, responses);
    expect(r.type_code).toBe("B-H-N-F");
  });

  it("quick form leaves the 4 non-representative axes unresolved without failing", () => {
    const qs = quickForm();
    const r = scoreProfile(qs, answerAll(qs, "agree"));
    expect(r.type_code).toBe("B-A-N-G");
    expect(r.unresolved_axes.sort()).toEqual(
      ["context_handoff", "output_absorption", "failure_handling", "exploration_taste"].sort()
    );
  });

  it("any unresolved representative axis → type_code null (retake, no guessing)", () => {
    const qs = quickForm();
    const responses = qs.map((q) => ({
      question_id: q.question_id,
      answer: (q.axis === "trust_rhythm" ? "unobserved" : "agree") as ProfileResponse["answer"],
    }));
    const r = scoreProfile(qs, responses);
    expect(r.type_code).toBeNull();
    expect(r.unresolved_axes).toContain("trust_rhythm");
  });
});

// ── input validation ────────────────────────────────────────────────────────

describe("input validation", () => {
  it("rejects duplicate question ids in the catalog", () => {
    const qs = [...axisQuestions("delegation_breadth", 1), ...axisQuestions("delegation_breadth", 1)];
    expect(() => scoreProfile(qs, [])).toThrow(/duplicate question_id/);
  });

  it("rejects responses to unknown questions", () => {
    expect(() => scoreProfile(axisQuestions("delegation_breadth", 1), [{ question_id: "ghost", answer: "agree" }]))
      .toThrow(/unknown question_id/);
  });

  it("rejects duplicate responses to the same question", () => {
    const qs = axisQuestions("delegation_breadth", 1);
    expect(() =>
      scoreProfile(qs, [
        { question_id: "delegation_breadth-1", answer: "agree" },
        { question_id: "delegation_breadth-1", answer: "disagree" },
      ])
    ).toThrow(/duplicate response/);
  });

  it("rejects malformed answers via zod", () => {
    const qs = axisQuestions("delegation_breadth", 1);
    expect(() => scoreProfile(qs, [{ question_id: "delegation_breadth-1", answer: "maybe" as never }])).toThrow();
  });
});

// ── observation ↔ self-report delta (§ 1.2) ─────────────────────────────────

describe("compareProfiles — observation vs self-report (§ 1.2)", () => {
  it("surfaces axes where agent and human resolved to opposite poles", () => {
    const qs = quickForm();
    const observed = scoreProfile(qs, answerAll(qs, "agree")); // B-A-N-G
    const self = scoreProfile(
      qs,
      qs.map((q) => ({
        question_id: q.question_id,
        answer: (q.axis === "delegation_breadth" ? "disagree" : "agree") as ProfileResponse["answer"],
      }))
    ); // S-A-N-G
    const delta = compareProfiles(observed, self);
    expect(delta.mismatch_axes).toEqual(["delegation_breadth"]);
    expect(delta.deltas.delegation_breadth).toBe(2); // +1 observed − (−1) self
    expect(delta.deltas.initiative_direction).toBe(0);
  });

  it("unresolved axes never count as mismatches", () => {
    const qs = quickForm();
    const observed = scoreProfile(qs, answerAll(qs, "agree"));
    const self = scoreProfile(
      qs,
      qs.map((q) => ({
        question_id: q.question_id,
        answer: (q.axis === "trust_rhythm" ? "unobserved" : "disagree") as ProfileResponse["answer"],
      }))
    );
    const delta = compareProfiles(observed, self);
    expect(delta.mismatch_axes).not.toContain("trust_rhythm");
    expect(delta.mismatch_axes).toContain("delegation_breadth");
  });
});
