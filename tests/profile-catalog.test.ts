import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROFILE_AXES,
  REPRESENTATIVE_AXES,
  profileQuestionSchema,
  scoreProfile,
  type ProfileQuestionInput,
} from "@/lib/profile";

/**
 * Guards the real question pool (supabase/seed/profile_questions.json, authored
 * in design note 22) against drift from the design contract: 8 axes × 12 binary
 * deep questions (6 per pole, one weight-2 core per pole) + 8 × 3 likert5 short
 * questions, ids unique, every row scoreable.
 */

type CatalogRow = ProfileQuestionInput & { form: "deep" | "short"; prompt: string; ordering: number };

const catalog: CatalogRow[] = JSON.parse(
  readFileSync(join(__dirname, "..", "supabase", "seed", "profile_questions.json"), "utf8")
);

describe("profile question catalog (design note 22)", () => {
  it("has 96 deep + 24 short questions with unique ids and prompts", () => {
    expect(catalog).toHaveLength(120);
    expect(catalog.filter((q) => q.form === "deep")).toHaveLength(96);
    expect(catalog.filter((q) => q.form === "short")).toHaveLength(24);
    expect(new Set(catalog.map((q) => q.question_id)).size).toBe(120);
    expect(new Set(catalog.map((q) => q.prompt)).size).toBe(120);
  });

  it("every row passes the question schema and form↔format coherence", () => {
    for (const q of catalog) {
      const parsed = profileQuestionSchema.parse(q);
      expect(q.prompt.trim().length).toBeGreaterThan(0);
      expect(q.form === "deep" ? "binary" : "likert5").toBe(parsed.format);
      expect(q.question_id.startsWith(q.form === "deep" ? "d-" : "h-")).toBe(true);
    }
  });

  it("deep form: per axis 12 questions, 6 per pole, one w2 core per pole", () => {
    for (const axis of PROFILE_AXES) {
      const qs = catalog.filter((q) => q.form === "deep" && q.axis === axis);
      expect(qs, axis).toHaveLength(12);
      const a = qs.filter((q) => q.pole === "A");
      const b = qs.filter((q) => q.pole === "B");
      expect(a, axis).toHaveLength(6);
      expect(b, axis).toHaveLength(6);
      expect(a.filter((q) => q.weight === 2), axis).toHaveLength(1);
      expect(b.filter((q) => q.weight === 2), axis).toHaveLength(1);
    }
  });

  it("short form: per axis 3 questions, both poles represented, all w1", () => {
    for (const axis of PROFILE_AXES) {
      const qs = catalog.filter((q) => q.form === "short" && q.axis === axis);
      expect(qs, axis).toHaveLength(3);
      expect(new Set(qs.map((q) => q.pole)).size, axis).toBe(2);
      expect(qs.every((q) => q.weight === 1), axis).toBe(true);
    }
  });

  it("both full forms score end-to-end and can produce a complete type code", () => {
    const deep = catalog.filter((q) => q.form === "deep");
    const short = catalog.filter((q) => q.form === "short");

    // agree-to-everything is direction-mixed (balanced poles) yet must not throw
    const observed = scoreProfile(deep, deep.map((q) => ({ question_id: q.question_id, answer: "agree" as const })));
    expect(Object.keys(observed.axes)).toHaveLength(8);

    // answering with each question's own pole resolves all four representative axes
    const self = scoreProfile(
      short,
      short.map((q) => ({
        question_id: q.question_id,
        answer: q.pole === "B" ? ("strongly_agree" as const) : ("strongly_disagree" as const),
      }))
    );
    expect(self.type_code).not.toBeNull();
    expect(self.type_code!.split("-")).toHaveLength(REPRESENTATIVE_AXES.length);
  });
});

// ── note 25 — results copy layer ────────────────────────────────────────────

import { ARCHETYPES } from "@/lib/archetypes";
import { POLE_PHRASE, MISMATCH_KICKER, deltaNarrative } from "@/lib/delta-copy";
import { PROFILE_AXES, scoreProfile, type ProfileQuestionInput } from "@/lib/profile";

describe("results copy (note 25)", () => {
  it("every archetype carries the full copy block", () => {
    expect(ARCHETYPES).toHaveLength(16);
    for (const a of ARCHETYPES) {
      expect(a.reads.length).toBeGreaterThan(100);
      expect(a.thrives.length).toBeGreaterThanOrEqual(2);
      expect(a.frays.length).toBeGreaterThanOrEqual(2);
      expect(a.try_this.length).toBeGreaterThan(20);
      expect(a.duos.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("delta copy covers all 8 axes", () => {
    for (const axis of PROFILE_AXES) {
      expect(POLE_PHRASE[axis].A).toBeTruthy();
      expect(POLE_PHRASE[axis].B).toBeTruthy();
      expect(MISMATCH_KICKER[axis]).toBeTruthy();
    }
  });

  it("deltaNarrative classifies mismatch / agree / open deterministically", () => {
    const qs: ProfileQuestionInput[] = PROFILE_AXES.map((axis) => ({
      question_id: `${axis}-1`,
      axis,
      pole: "B",
      weight: 1,
    }));
    const observed = scoreProfile(qs, qs.map((q) => ({ question_id: q.question_id, answer: "agree" as const })));
    const self = scoreProfile(
      qs,
      qs.map((q) => ({
        question_id: q.question_id,
        answer: (q.axis === "trust_rhythm" ? "disagree" : "agree") as "agree" | "disagree",
      }))
    );
    const story = deltaNarrative(observed, self, "TestBot");
    expect(story.mismatchCount).toBe(1);
    expect(story.lines.find((l) => l.axis === "trust_rhythm")?.kind).toBe("mismatch");
    expect(story.lines.filter((l) => l.kind === "agree")).toHaveLength(7);
    expect(story.opener).toContain("TestBot");
    // determinism
    expect(deltaNarrative(observed, self, "TestBot")).toEqual(story);
  });
});
