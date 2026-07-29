import { z } from "zod";
import type { Db, Sql } from "./db";
import { toArrayLiteral } from "./db";
import { HttpError, type Actor } from "./auth";
import { profileInviteEmail, sendEmail } from "./email";
import {
  DEFAULT_THETA,
  DEFAULT_THETA_SHORT,
  PROFILE_ANSWERS,
  compareProfiles,
  scoreProfile,
  type ProfileDelta,
  type ProfileQuestionInput,
  type ProfileResult,
} from "./profile";

/**
 * Pair Profile 검사 — DB side (design note 21). Scoring stays pure in
 * profile.ts (no db import there); this module owns the question catalog,
 * accumulated raw responses (core asset — Mason 2026-07-23, never overwritten)
 * and scored results. Two takes per pair — agent deep form (binary, from real
 * collaboration logs) and human short form (likert5 self-report) — and the
 * observed↔self-report delta between them is the product feature.
 */

export const PROFILE_FORMS = ["deep", "short"] as const;
export type ProfileForm = (typeof PROFILE_FORMS)[number];

export const PROFILE_SOURCES = ["agent_deep", "human_short"] as const;
export type ProfileSource = (typeof PROFILE_SOURCES)[number];

/** source ↔ form: the agent answers the deep form, the human the short one. */
const FORM_OF_SOURCE: Record<ProfileSource, ProfileForm> = {
  agent_deep: "deep",
  human_short: "short",
};

// ── question catalog ─────────────────────────────────────────────────────────

export interface CatalogQuestion {
  question_id: string;
  axis: string;
  pole: "A" | "B";
  weight: number;
  format: "binary" | "likert5";
  prompt: string;
  form: ProfileForm;
  ordering: number;
}

export async function listProfileQuestions(db: Sql, form?: ProfileForm): Promise<CatalogQuestion[]> {
  const r = await db.query<CatalogQuestion>(
    `select question_id, axis, pole, weight, format, prompt, form, ordering
       from profile_questions
      where active and ($1::profile_form is null or form = $1)
      order by ordering, question_id`,
    [form ?? null]
  );
  return r.rows;
}

// ── submit — one transaction: submission + responses + scored result ─────────

export const submitProfileSchema = z.object({
  source: z.enum(PROFILE_SOURCES),
  responses: z
    .array(z.object({ question_id: z.string().min(1), answer: z.enum(PROFILE_ANSWERS) }))
    .min(1)
    .max(500),
});
export type SubmitProfileInput = z.infer<typeof submitProfileSchema>;

export interface SubmittedProfile {
  submission_id: string;
  result_id: string;
  source: ProfileSource;
  /** human_short is self-report → approved on submit; agent_deep waits for the human. */
  approved: boolean;
  approved_at: string | null;
  result: ProfileResult;
}

/**
 * Store one test take: submission + raw response rows (accumulated — retakes
 * over time are expected, § 1.3) + the deterministic score frozen as a
 * profile_results row. θ comes from platform_config (DEFAULT_THETA fallback).
 * Guardrail: the agent-written profile of the human starts unapproved —
 * publication (a later registerCard step) requires the human's approval.
 */
export async function submitProfileResponses(
  db: Db,
  actor: Actor,
  rawInput: unknown
): Promise<SubmittedProfile> {
  if (actor.kind !== "pair") {
    throw new HttpError(401, "Profile submission requires a registered pair key.");
  }
  const input = submitProfileSchema.parse(rawInput);
  const form = FORM_OF_SOURCE[input.source];

  return db.tx(async (tx) => {
    // the matching form's active catalog only — a deep take may not answer
    // short questions and vice versa (wrong-form responses are rejected below)
    const catalog = await tx.query<CatalogQuestion>(
      `select question_id, axis, pole, weight, format
         from profile_questions where active and form = $1`,
      [form]
    );
    if (catalog.rows.length === 0) {
      throw new HttpError(409, `No active ${form}-form questions yet — the question pool ships as data.`);
    }
    const known = new Set(catalog.rows.map((q) => q.question_id));

    const seen = new Set<string>();
    for (const r of input.responses) {
      if (!known.has(r.question_id)) {
        throw new HttpError(
          422,
          `question ${r.question_id} is not an active ${form}-form question (source ${input.source} answers the ${form} form only)`
        );
      }
      if (seen.has(r.question_id)) {
        throw new HttpError(422, `duplicate response for question ${r.question_id}`);
      }
      seen.add(r.question_id);
    }

    const theta = await readProfileTheta(tx, form);
    let result: ProfileResult;
    try {
      result = scoreProfile(catalog.rows as ProfileQuestionInput[], input.responses, { theta });
    } catch (e) {
      // remaining scoreProfile throws are input-shaped (e.g. likert answer on a binary question)
      throw new HttpError(422, e instanceof Error ? e.message : "invalid responses");
    }

    const sub = await tx.query<{ submission_id: string }>(
      `insert into profile_submissions (pair_id, source) values ($1, $2) returning submission_id`,
      [actor.pairId, input.source]
    );
    const submissionId = sub.rows[0].submission_id;

    await tx.query(
      `insert into profile_responses (submission_id, question_id, answer)
       select $1::uuid, q, a::profile_answer
         from unnest($2::text[], $3::text[]) as t(q, a)`,
      [
        submissionId,
        toArrayLiteral(input.responses.map((r) => r.question_id)),
        toArrayLiteral(input.responses.map((r) => r.answer)),
      ]
    );

    // human_short is the human's own self-report — nothing to gate, approve on
    // submit; agent_deep (the agent's read of the human) waits for the human.
    const selfApproved = input.source === "human_short";
    const res = await tx.query<{ result_id: string; approved_at: string | null }>(
      `insert into profile_results
         (pair_id, source, submission_id, axes, type_code, unresolved_axes, completeness, theta, approved_at)
       values ($1,$2,$3,$4,$5,$6::text[],$7,$8, case when $9::boolean then now() end)
       returning result_id, approved_at`,
      [
        actor.pairId,
        input.source,
        submissionId,
        JSON.stringify(result.axes),
        result.type_code,
        toArrayLiteral(result.unresolved_axes),
        result.completeness,
        result.theta,
        selfApproved,
      ]
    );

    return {
      submission_id: submissionId,
      result_id: res.rows[0].result_id,
      source: input.source,
      approved: selfApproved,
      approved_at: res.rows[0].approved_at ?? null,
      result,
    };
  });
}

/**
 * Observer pull (note 24 § 4): the first deep-form result, while the human's
 * short form doesn't exist yet, triggers one invite to the pair's email.
 * Enrichment only — every miss (no email, already invited, send failure,
 * even a query error) leaves the submission untouched.
 */
export async function maybeSendProfileInvite(db: Sql, pairId: string): Promise<void> {
  try {
    const r = await db.query<{
      email: string | null;
      instance_name: string;
      deep_count: string;
      short_count: string;
    }>(
      `select p.email, p.instance_name,
              count(*) filter (where pr.source = 'agent_deep') as deep_count,
              count(*) filter (where pr.source = 'human_short') as short_count
         from pairs p left join profile_results pr using (pair_id)
        where p.pair_id = $1
        group by p.email, p.instance_name`,
      [pairId]
    );
    const row = r.rows[0];
    if (!row?.email) return;
    if (Number(row.short_count) > 0) return; // human already took their side
    if (Number(row.deep_count) !== 1) return; // invite rides the first read only
    await sendEmail(profileInviteEmail(row.email, row.instance_name));
  } catch (e) {
    console.error("[profile-invite]", e);
  }
}

/**
 * θ per form from platform_config ('profile_theta' / 'profile_theta_short'),
 * form default when absent/invalid. Split per note 24 § 1: the short form
 * resolves any lean (θ 0), the deep form keeps its unresolved band.
 */
async function readProfileTheta(db: Sql, form: ProfileForm): Promise<number> {
  const key = form === "short" ? "profile_theta_short" : "profile_theta";
  const fallback = form === "short" ? DEFAULT_THETA_SHORT : DEFAULT_THETA;
  const r = await db.query<{ value: unknown }>(`select value from platform_config where key = $1`, [
    key,
  ]);
  const v = Number(r.rows[0]?.value);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
}

// ── read — latest result per source + observed↔self-report delta ────────────

export interface StoredProfileResult {
  result_id: string;
  submission_id: string;
  source: ProfileSource;
  approved: boolean;
  approved_at: string | null;
  published_card_id: string | null;
  created_at: string;
  result: ProfileResult;
}

export interface PairProfile {
  pair_id: string;
  agent_deep: StoredProfileResult | null;
  human_short: StoredProfileResult | null;
  /** compareProfiles(observed, self-report) — present only when both exist. */
  delta: ProfileDelta | null;
}

/**
 * Latest result per source (longitudinal history stays queryable underneath).
 * Both sides come back with `approved` flags — whether an unapproved
 * agent_deep result may be shown is the caller's (route's) visibility call,
 * mirroring the viewer-tier spirit of cards.ts.
 */
export async function getPairProfile(db: Sql, pairId: string): Promise<PairProfile> {
  const pair = await db.query(`select pair_id from pairs where pair_id = $1`, [pairId]);
  if (!pair.rows[0]) throw new HttpError(404, "pair not found");

  const r = await db.query<any>(
    `select distinct on (source)
            result_id, submission_id, source, axes, type_code, unresolved_axes,
            completeness, theta, approved_at, published_card_id, created_at
       from profile_results
      where pair_id = $1
      order by source, created_at desc, result_id`,
    [pairId]
  );

  let agentDeep: StoredProfileResult | null = null;
  let humanShort: StoredProfileResult | null = null;
  for (const row of r.rows) {
    const stored: StoredProfileResult = {
      result_id: row.result_id,
      submission_id: row.submission_id,
      source: row.source,
      approved: row.approved_at != null,
      approved_at: row.approved_at ?? null,
      published_card_id: row.published_card_id ?? null,
      created_at: row.created_at,
      result: {
        axes: row.axes,
        type_code: row.type_code ?? null,
        unresolved_axes: row.unresolved_axes ?? [],
        completeness: Number(row.completeness), // numeric arrives as string
        theta: Number(row.theta),
      },
    };
    if (row.source === "agent_deep") agentDeep = stored;
    else humanShort = stored;
  }

  return {
    pair_id: pairId,
    agent_deep: agentDeep,
    human_short: humanShort,
    delta: agentDeep && humanShort ? compareProfiles(agentDeep.result, humanShort.result) : null,
  };
}

// ── approve — the human's gate on the agent-written profile ─────────────────

export const approveProfileSchema = z.object({ result_id: z.string().uuid() });

/**
 * The pair's human approves their agent_deep result, making it publishable
 * (actual card publication is a later step). Idempotent; only the owning
 * pair can approve, and only agent_deep results need approving.
 */
export async function approveAgentProfile(db: Sql, actor: Actor, resultId: string) {
  if (actor.kind !== "pair") {
    throw new HttpError(401, "Approving a profile requires the owning pair's key.");
  }
  const r = await db.query<{ result_id: string; approved_at: string }>(
    `update profile_results
        set approved_at = coalesce(approved_at, now())
      where result_id = $1 and pair_id = $2 and source = 'agent_deep'
      returning result_id, approved_at`,
    [resultId, actor.pairId]
  );
  if (!r.rows[0]) {
    throw new HttpError(404, "agent_deep result not found for your pair (human_short self-reports need no approval)");
  }
  return { result_id: r.rows[0].result_id, approved: true, approved_at: r.rows[0].approved_at };
}
