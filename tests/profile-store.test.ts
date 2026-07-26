import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeTestDb } from "./helpers/db";
import type { Db } from "@/lib/db";
import { registerPair } from "@/lib/pairs";
import { resolveActor, type Actor } from "@/lib/auth";
import { PROFILE_AXES, DEFAULT_THETA } from "@/lib/profile";
import {
  listProfileQuestions,
  submitProfileResponses,
  getPairProfile,
  approveAgentProfile,
} from "@/lib/profile-store";

/**
 * Pair Profile persistence (design note 21, migration 0003) — question
 * catalog, accumulated submissions, deterministic scoring via profile.ts,
 * approval gate, latest-per-source reads + observed↔self-report delta.
 * makeTestDb applies every supabase/migrations/*.sql in order, 0003 included.
 */

let db: Db;
let close: () => Promise<void>;

let pairActor: Actor; // owning pair — takes the test
let otherActor: Actor; // a different pair — must not approve the owner's result
let pairId: string;

const AXIS_ABBR: Record<string, string> = {
  delegation_breadth: "del",
  context_handoff: "ctx",
  initiative_direction: "ini",
  output_absorption: "out",
  failure_handling: "fail",
  exploration_taste: "exp",
  decision_style: "dec",
  trust_rhythm: "tru",
};

/** Test catalog: 2 binary deep questions + 1 likert5 short question per axis,
 *  all phrased toward pole B, weight 1 — the real pool ships as data. */
async function seedQuestions() {
  let ord = 0;
  for (const axis of PROFILE_AXES) {
    const abbr = AXIS_ABBR[axis];
    for (const n of ["01", "02"]) {
      await db.query(
        `insert into profile_questions (question_id, axis, pole, weight, format, prompt, form, ordering)
         values ($1, $2, 'B', 1, 'binary', $3, 'deep', $4)`,
        [`d-${abbr}-${n}`, axis, `deep statement ${n} toward pole B of ${axis}`, ord++]
      );
    }
    await db.query(
      `insert into profile_questions (question_id, axis, pole, weight, format, prompt, form, ordering)
       values ($1, $2, 'B', 1, 'likert5', $3, 'short', $4)`,
      [`s-${abbr}-01`, axis, `short statement toward pole B of ${axis}`, ord++]
    );
  }
}

function deepAnswers(answer: string) {
  return PROFILE_AXES.flatMap((axis) => [
    { question_id: `d-${AXIS_ABBR[axis]}-01`, answer },
    { question_id: `d-${AXIS_ABBR[axis]}-02`, answer },
  ]);
}
function shortAnswers(answer: string) {
  return PROFILE_AXES.map((axis) => ({ question_id: `s-${AXIS_ABBR[axis]}-01`, answer }));
}

beforeAll(async () => {
  ({ db, close } = await makeTestDb());
  await seedQuestions();

  const pair = await registerPair(db, { model_base: "claude", service_tier: "Claude Code", instance_name: "Claudi" });
  pairId = pair.pair_id;
  pairActor = await resolveActor(db, `Bearer ${pair.api_key}`);

  const other = await registerPair(db, { model_base: "gpt", instance_name: "Nova" });
  otherActor = await resolveActor(db, `Bearer ${other.api_key}`);
});

afterAll(async () => {
  await close();
});

// ── catalog ──────────────────────────────────────────────────────────────────

describe("question catalog", () => {
  it("lists active questions, filterable by form", async () => {
    const all = await listProfileQuestions(db);
    expect(all.length).toBe(24); // 16 deep + 8 short
    const deep = await listProfileQuestions(db, "deep");
    expect(deep.length).toBe(16);
    expect(deep.every((q) => q.format === "binary")).toBe(true);
    const short = await listProfileQuestions(db, "short");
    expect(short.length).toBe(8);
    expect(short.every((q) => q.format === "likert5")).toBe(true);
  });

  it("DB rejects a form↔format mismatch (deep must be binary)", async () => {
    await expect(
      db.query(
        `insert into profile_questions (question_id, axis, pole, weight, format, prompt, form)
         values ('d-bad-01', 'decision_style', 'A', 1, 'likert5', 'mismatched', 'deep')`
      )
    ).rejects.toThrow();
  });
});

// ── submit — agent deep form ─────────────────────────────────────────────────

describe("submit — agent_deep (§ 4 deterministic scoring persisted)", () => {
  it("happy path: all-agree deep take → resolved axes + type_code, unapproved", async () => {
    const r = await submitProfileResponses(db, pairActor, {
      source: "agent_deep",
      responses: deepAnswers("agree"),
    });
    expect(r.source).toBe("agent_deep");
    expect(r.approved).toBe(false); // guardrail: waits for the human
    expect(r.approved_at).toBeNull();
    expect(r.result.type_code).toBe("B-A-N-G"); // all axes pole B
    expect(r.result.completeness).toBe(1);
    expect(r.result.unresolved_axes).toEqual([]);

    // persisted: submission + raw responses (accumulated asset) + frozen result
    const sub = await db.query(`select source, pair_id from profile_submissions where submission_id = $1`, [
      r.submission_id,
    ]);
    expect(sub.rows[0]).toMatchObject({ source: "agent_deep", pair_id: pairId });
    const resp = await db.query(`select count(*) as n from profile_responses where submission_id = $1`, [
      r.submission_id,
    ]);
    expect(Number(resp.rows[0].n)).toBe(16);
    const row = await db.query(
      `select type_code, axes, approved_at, unresolved_axes from profile_results where result_id = $1`,
      [r.result_id]
    );
    expect(row.rows[0].type_code).toBe("B-A-N-G");
    expect(row.rows[0].approved_at).toBeNull();
    expect(row.rows[0].unresolved_axes).toEqual([]);
    expect(row.rows[0].axes.delegation_breadth.pole).toBe("B");
    expect(row.rows[0].axes.delegation_breadth.score).toBe(1);
  });

  it("rejects responses to questions of the wrong form", async () => {
    await expect(
      submitProfileResponses(db, pairActor, {
        source: "agent_deep",
        responses: [...deepAnswers("agree"), { question_id: "s-del-01", answer: "agree" }],
      })
    ).rejects.toThrow(/not an active deep-form question/i);
  });

  it("rejects a duplicate question within one submission", async () => {
    await expect(
      submitProfileResponses(db, pairActor, {
        source: "agent_deep",
        responses: [
          { question_id: "d-del-01", answer: "agree" },
          { question_id: "d-del-01", answer: "disagree" },
        ],
      })
    ).rejects.toThrow(/duplicate response/i);
  });

  it("rejects likert-only answers on the binary deep form", async () => {
    await expect(
      submitProfileResponses(db, pairActor, {
        source: "agent_deep",
        responses: [{ question_id: "d-del-01", answer: "strongly_agree" }],
      })
    ).rejects.toThrow(/not allowed for binary/i);
  });

  it("requires a registered pair (agents/anonymous cannot take the test)", async () => {
    await expect(
      submitProfileResponses(db, { kind: "anonymous" }, { source: "agent_deep", responses: deepAnswers("agree") })
    ).rejects.toThrow(/registered pair/i);
  });
});

// ── θ from platform_config ───────────────────────────────────────────────────

describe("theta — platform_config with DEFAULT_THETA fallback", () => {
  it("reads θ from platform_config: raised threshold unresolves half-observed axes", async () => {
    await db.query(`update platform_config set value = '0.9' where key = 'profile_theta'`);
    // one agree + one unobserved per axis → |score| = 0.5 < 0.9 → unresolved
    const half = PROFILE_AXES.flatMap((axis) => [
      { question_id: `d-${AXIS_ABBR[axis]}-01`, answer: "agree" },
      { question_id: `d-${AXIS_ABBR[axis]}-02`, answer: "unobserved" },
    ]);
    const r = await submitProfileResponses(db, pairActor, { source: "agent_deep", responses: half });
    expect(r.result.theta).toBe(0.9);
    expect(r.result.type_code).toBeNull(); // retake prompt, not an error state
    expect(r.result.unresolved_axes.length).toBe(PROFILE_AXES.length);
    await db.query(`update platform_config set value = '0.2' where key = 'profile_theta'`);
  });

  it("falls back to DEFAULT_THETA when the config row is missing", async () => {
    await db.query(`delete from platform_config where key = 'profile_theta'`);
    const r = await submitProfileResponses(db, pairActor, { source: "agent_deep", responses: deepAnswers("agree") });
    expect(r.result.theta).toBe(DEFAULT_THETA);
    await db.query(`insert into platform_config (key, value) values ('profile_theta', '0.2')`);
  });
});

// ── longitudinal — resubmission + latest-per-source read ────────────────────

describe("getPairProfile — latest per source + delta (§ 1.2)", () => {
  it("resubmission creates a new result and latest-lookup returns the newer one", async () => {
    const before = await db.query(
      `select count(*) as n from profile_results where pair_id = $1 and source = 'agent_deep'`,
      [pairId]
    );
    // all-disagree take → every axis flips to pole A
    const r = await submitProfileResponses(db, pairActor, { source: "agent_deep", responses: deepAnswers("disagree") });
    expect(r.result.type_code).toBe("S-H-I-F");

    const after = await db.query(
      `select count(*) as n from profile_results where pair_id = $1 and source = 'agent_deep'`,
      [pairId]
    );
    expect(Number(after.rows[0].n)).toBe(Number(before.rows[0].n) + 1); // accumulated, never overwritten

    const profile = await getPairProfile(db, pairId);
    expect(profile.agent_deep?.result_id).toBe(r.result_id);
    expect(profile.agent_deep?.result.type_code).toBe("S-H-I-F");
    expect(profile.human_short).toBeNull();
    expect(profile.delta).toBeNull(); // no self-report yet
  });

  it("human_short is self-report → approved on submit", async () => {
    const r = await submitProfileResponses(db, pairActor, { source: "human_short", responses: shortAnswers("agree") });
    expect(r.approved).toBe(true);
    expect(r.approved_at).toBeTruthy();
    expect(r.result.type_code).toBe("B-A-N-G"); // likert agree = +0.5 ≥ θ=0.2 on every axis
  });

  it("returns latest per source + compareProfiles delta when both exist", async () => {
    const profile = await getPairProfile(db, pairId);
    expect(profile.agent_deep?.result.type_code).toBe("S-H-I-F"); // observed
    expect(profile.human_short?.result.type_code).toBe("B-A-N-G"); // self-report
    expect(profile.human_short?.approved).toBe(true);
    expect(profile.agent_deep?.approved).toBe(false);

    // observed −1 vs self-report +0.5 on every axis → delta −1.5, all poles clash
    expect(profile.delta).not.toBeNull();
    expect(profile.delta!.mismatch_axes.length).toBe(PROFILE_AXES.length);
    expect(profile.delta!.deltas.decision_style).toBeCloseTo(-1.5);
  });

  it("404s on an unknown pair", async () => {
    await expect(getPairProfile(db, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/not found/i);
  });
});

// ── approval gate — the human publishes the agent's read of them ────────────

describe("approval gate (guardrail)", () => {
  it("owning pair approves its agent_deep result; idempotent", async () => {
    const profile = await getPairProfile(db, pairId);
    const resultId = profile.agent_deep!.result_id;

    const a = await approveAgentProfile(db, pairActor, resultId);
    expect(a.approved).toBe(true);
    expect(a.approved_at).toBeTruthy();

    const again = await approveAgentProfile(db, pairActor, resultId);
    expect(again.approved_at).toEqual(a.approved_at); // coalesce keeps the first stamp

    const fresh = await getPairProfile(db, pairId);
    expect(fresh.agent_deep?.approved).toBe(true);
  });

  it("another pair cannot approve someone else's result", async () => {
    const profile = await getPairProfile(db, pairId);
    await expect(approveAgentProfile(db, otherActor, profile.agent_deep!.result_id)).rejects.toThrow(/not found/i);
  });

  it("human_short results need no approval and cannot be targeted", async () => {
    const profile = await getPairProfile(db, pairId);
    await expect(approveAgentProfile(db, pairActor, profile.human_short!.result_id)).rejects.toThrow(/not found/i);
  });
});
