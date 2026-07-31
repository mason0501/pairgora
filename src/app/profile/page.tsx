"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AXIS_SPECS,
  PROFILE_AXES,
  REPRESENTATIVE_AXES,
  compareProfiles,
  type AxisResult,
  type ProfileAnswer,
  type ProfileAxis,
  type ProfileResult,
} from "@/lib/profile";
import { archetypeOf } from "@/lib/archetypes";
import { axisDisplayName, deltaNarrative, type DeltaLine } from "@/lib/delta-copy";

/**
 * Pair Profile — human short form + results hub (design note 21).
 * The human answers 24 likert5 statements (~5 minutes); scoring is the same
 * deterministic table the agent's deep form uses. Direction, not level:
 * both poles of every axis are equal, and unresolved axes are an invitation
 * to retake as the pair logs more hours — never a failure state.
 */

// ── wire shapes (client-side mirrors; server types live in profile-store.ts) ──

interface ShortQuestion {
  question_id: string;
  axis: ProfileAxis;
  pole: "A" | "B";
  weight: number;
  format: string;
  prompt: string;
  form: string;
  ordering: number;
}

interface StoredResult {
  result_id: string;
  source: "agent_deep" | "human_short";
  approved: boolean;
  approved_at: string | null;
  created_at: string;
  result: ProfileResult;
}

interface PairProfileView {
  pair_id: string;
  agent_deep: StoredResult | null;
  human_short: StoredResult | null;
  delta: { deltas: Record<ProfileAxis, number>; mismatch_axes: ProfileAxis[] } | null;
}

// likert5, rendered disagree → agree; "unobserved" is the subtle skip
const LIKERT: Array<{ value: ProfileAnswer; label: string }> = [
  { value: "strongly_disagree", label: "Strongly disagree" },
  { value: "disagree", label: "Disagree" },
  { value: "neutral", label: "Neutral" },
  { value: "agree", label: "Agree" },
  { value: "strongly_agree", label: "Strongly agree" },
];

const pct = (score: number) => ((score + 1) / 2) * 100;
const axisName = (axis: ProfileAxis) => axis.replace(/_/g, " ");
const repLetters = new Map(REPRESENTATIVE_AXES.map((r) => [r.axis, r]));

// ── spectrum bar — one axis, one or two inks ─────────────────────────────────

interface Marker {
  who: "human" | "agent";
  score: number;
  resolved: boolean;
}

function AxisBar({
  axis,
  markers,
  theta,
  mismatch,
}: {
  axis: ProfileAxis;
  markers: Marker[];
  theta: number;
  mismatch?: boolean;
}) {
  const spec = AXIS_SPECS[axis];
  const rep = repLetters.get(axis);
  // pole emphasis follows the resolved marker(s); ties/unresolved stay neutral
  const poles = new Set(markers.filter((m) => m.resolved).map((m) => (m.score > 0 ? "B" : "A")));
  const chosenA = poles.size === 1 && poles.has("A");
  const chosenB = poles.size === 1 && poles.has("B");
  const unresolved = markers.every((m) => !m.resolved);

  return (
    <div className={`axis-row${mismatch ? " mismatch" : ""}`}>
      <div className="axis-poles">
        <span className={`pole${chosenA ? " chosen" : ""}`}>
          {rep ? `${rep.letter_a} · ` : ""}
          {spec.pole_a}
        </span>
        <span className="axis-title">
          {axisName(axis)}
          {mismatch && <span className="delta-chip"> · seen differently</span>}
        </span>
        <span className={`pole${chosenB ? " chosen" : ""}`}>
          {spec.pole_b}
          {rep ? ` · ${rep.letter_b}` : ""}
        </span>
      </div>
      <div className="axis-track">
        <span
          className="axis-band"
          style={{ left: `${((1 - theta) / 2) * 100}%`, width: `${theta * 100}%` }}
          title={`unresolved band — |score| below θ=${theta}`}
        />
        <span className="axis-mid" />
        {markers.map((m) => (
          <span
            key={m.who}
            className={`axis-marker ${m.who}${m.resolved ? "" : " open"}`}
            style={{ left: `${pct(m.score)}%` }}
            title={`${m.who === "human" ? "you (self-report)" : "your agent (observed)"}: ${
              m.score >= 0 ? "+" : ""
            }${m.score.toFixed(2)}${m.resolved ? "" : " — unresolved"}`}
          />
        ))}
      </div>
      {unresolved && (
        <p className="axis-note">not enough signal yet on this axis — retake later, it resolves as your pair logs more time</p>
      )}
    </div>
  );
}

function AxesSection({
  human,
  agent,
  mismatchAxes,
}: {
  human?: ProfileResult | null;
  agent?: ProfileResult | null;
  mismatchAxes?: ProfileAxis[];
}) {
  const theta = human?.theta ?? agent?.theta ?? 0.2;
  const mismatch = new Set(mismatchAxes ?? []);
  const layers: Array<{ layer: "L1" | "L2"; title: string }> = [
    { layer: "L1", title: "How the pair operates" },
    { layer: "L2", title: "How the human leans" },
  ];
  return (
    <>
      {layers.map(({ layer, title }) => (
        <div key={layer}>
          <h3 className="axes-layer-title">{title}</h3>
          {PROFILE_AXES.filter((a) => AXIS_SPECS[a].layer === layer).map((a) => {
            const markers: Marker[] = [];
            const h: AxisResult | undefined = human?.axes[a];
            const g: AxisResult | undefined = agent?.axes[a];
            if (g) markers.push({ who: "agent", score: g.score, resolved: g.resolved });
            if (h) markers.push({ who: "human", score: h.score, resolved: h.resolved });
            return <AxisBar key={a} axis={a} markers={markers} theta={theta} mismatch={mismatch.has(a)} />;
          })}
        </div>
      ))}
    </>
  );
}

// ── type hero — 4-letter code + archetype, or the retake invitation ──────────

function TypeHero({ result }: { result: ProfileResult }) {
  const archetype = archetypeOf(result.type_code);
  // MBTI-style lean strength: |score| 0 → 50/50, |score| 1 → 100%. Makes a
  // 51%-lean letter honest next to a 90% one instead of hiding the difference.
  const leanPct = (axis: ProfileAxis) =>
    Math.round(50 + (result.axes[axis]?.strength ?? 0) * 50);
  if (result.type_code && archetype) {
    return (
      <div className="type-hero">
        <div>
          <span className="type-code">{result.type_code}</span>
          <span className="type-name"> {archetype.name}</span>
        </div>
        <p className="notice" style={{ margin: "6px 0 0" }}>
          {REPRESENTATIVE_AXES.map((rep, i) => {
            const r = result.axes[rep.axis];
            const letter = r?.pole === "A" ? rep.letter_a : rep.letter_b;
            return (
              <span key={rep.axis}>
                {i > 0 && " · "}
                {letter} {leanPct(rep.axis)}%
              </span>
            );
          })}
          {" · "}
          <a href={`/profile/types/${result.type_code!.toLowerCase()}`}>full type page →</a>
        </p>
        <p className="type-narrative">{archetype.narrative}</p>
      </div>
    );
  }
  const partialCode = REPRESENTATIVE_AXES.map((rep) => {
    const r = result.axes[rep.axis];
    if (!r?.resolved || r.pole === null) return "·";
    return r.pole === "A" ? rep.letter_a : rep.letter_b;
  }).join("-");
  const openReps = REPRESENTATIVE_AXES.filter((r) => !result.axes[r.axis]?.resolved).length;
  return (
    <div className="type-hero">
      <div>
        <span className="type-code open-code">{partialCode}</span>
        <span className="type-name"> No type yet</span>
      </div>
      <p className="type-narrative">
        {4 - openReps} of the 4 signature letters {openReps === 3 ? "has" : "have"} settled;{" "}
        {openReps} {openReps === 1 ? "axis sits" : "axes sit"} inside the unresolved band (|score| &lt;
        θ) even with every question answered. That&apos;s not a failure — it&apos;s a young pair.
        Retake later and the dots settle into letters.{" "}
        <a href="/profile/types">Browse the 16 types meanwhile →</a>
      </p>
    </div>
  );
}

function Completeness({ result }: { result: ProfileResult }) {
  const p = Math.round(result.completeness * 100);
  return (
    <div className="completeness">
      <span className="notice">signal completeness {p}%</span>
      <div className="progress-track" style={{ maxWidth: 220 }}>
        <div className="progress-fill" style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const [ready, setReady] = useState(false);
  const [pairId, setPairId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [pairIdInput, setPairIdInput] = useState("");
  const [keyInput, setKeyInput] = useState("");

  const [questions, setQuestions] = useState<ShortQuestion[]>([]);
  const [profile, setProfile] = useState<PairProfileView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"hub" | "form" | null>(null);
  const [answers, setAnswers] = useState<Record<string, ProfileAnswer>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPairId(localStorage.getItem("pairgora_pair_id"));
    setApiKey(localStorage.getItem("pairgora_pair_key"));
    setReady(true);
  }, []);

  const loadAll = useCallback(async (opts?: { soft?: boolean }) => {
    if (!pairId || !apiKey) return;
    if (!opts?.soft) setError(null);
    try {
      // the questions catalog is public, but sending the pair key keeps a
      // member out of the anonymous per-IP rate bucket
      const [qRes, pRes] = await Promise.all([
        fetch("/api/v1/profile/questions?form=short", {
          headers: { authorization: `Bearer ${apiKey}` },
        }),
        fetch(`/api/v1/profile/${pairId}`, { headers: { authorization: `Bearer ${apiKey}` } }),
      ]);
      const qData = await qRes.json();
      const pData = await pRes.json();
      if (!qRes.ok) throw new Error(qData.error ?? "failed to load questions");
      if (!pRes.ok) throw new Error(pData.error ?? "failed to load your pair profile");
      setQuestions(Array.isArray(qData.questions) ? qData.questions : []);
      setProfile(pData);
      setMode((m) => m ?? (pData.human_short ? "hub" : "form"));
    } catch (e: any) {
      // soft = background enrichment (post-submit) — a transient miss there
      // must never read as a failure of work already stored
      if (!opts?.soft) setError(e.message);
    } finally {
      setLoaded(true);
    }
  }, [pairId, apiKey]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  function saveKey(e: React.FormEvent) {
    e.preventDefault();
    const id = pairIdInput.trim();
    const key = keyInput.trim();
    if (!id || !key) return;
    localStorage.setItem("pairgora_pair_id", id);
    localStorage.setItem("pairgora_pair_key", key);
    setPairId(id);
    setApiKey(key);
    setError(null);
  }

  // A stored key can go stale (rotation, different pair on this browser) — a
  // 401 must fall back to the gate instead of dead-ending the filled form.
  // Answers live in state, so re-entering the key keeps them.
  function resetKey(message: string | null) {
    localStorage.removeItem("pairgora_pair_id");
    localStorage.removeItem("pairgora_pair_key");
    setPairId(null);
    setApiKey(null);
    setError(message);
  }

  const answered = useMemo(
    () => questions.filter((q) => answers[q.question_id] !== undefined).length,
    [questions, answers]
  );
  const allTouched = questions.length > 0 && answered === questions.length;

  async function submitForm() {
    if (!apiKey || !allTouched) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/profile/respond", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          source: "human_short",
          responses: questions.map((q) => ({
            question_id: q.question_id,
            answer: answers[q.question_id],
          })),
        }),
      });
      const data = await res.json();
      if (res.status === 401) {
        resetKey("This browser had a stored key that was not accepted — enter your pair id and key again. Your answers are kept.");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "submission failed");
      // The respond payload already carries the frozen result — render the hub
      // from it directly instead of gating stored results behind a refetch
      // whose transient failure used to read as a failed submission. The
      // delta is the same pure function the server runs, so it needs no
      // round-trip either.
      const stored: StoredResult = {
        result_id: data.result_id,
        source: "human_short",
        approved: data.approved ?? true,
        approved_at: data.approved_at ?? null,
        created_at: new Date().toISOString(),
        result: data.result,
      };
      setProfile((p) => {
        const base: PairProfileView =
          p ?? { pair_id: pairId!, agent_deep: null, human_short: null, delta: null };
        return {
          ...base,
          human_short: stored,
          delta: base.agent_deep ? compareProfiles(base.agent_deep.result, data.result) : null,
        };
      });
      setMode("hub");
      window.scrollTo({ top: 0 });
      // background refresh for anything server-side (published_card_id etc.);
      // its failure must not alarm — the submission is already stored & shown
      loadAll({ soft: true }).catch(() => {});
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function approve(resultId: string) {
    if (!apiKey) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/profile/approve", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ result_id: resultId }),
      });
      const data = await res.json();
      if (res.status === 401) {
        resetKey("This browser had a stored key that was not accepted — enter your pair id and key again.");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "approval failed");
      await loadAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return null;

  // ── key gate — pair key stays in this browser, sent only as Bearer ─────────
  if (!pairId || !apiKey) {
    return (
      <div className="form-card">
        <h1>Pair profile</h1>
        {error && <div className="error-box">{error}</div>}
        <p className="notice">
          The short form is your side of the pair profile — 24 statements, about 5 minutes. It needs
          your pair key; the key stays in this browser and is only sent as{" "}
          <code>Authorization: Bearer</code>.
        </p>
        <form onSubmit={saveKey}>
          <label>Pair ID</label>
          <input
            value={pairIdInput}
            onChange={(e) => setPairIdInput(e.target.value)}
            placeholder="the pair_id from registration"
          />
          <label>Pair API key</label>
          <input
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="pg_…"
            type="password"
          />
          <button disabled={!pairIdInput.trim() || !keyInput.trim()}>Use this pair</button>
        </form>
        <p className="notice" style={{ marginTop: 18 }}>
          No pair yet? <a href="/register">Register your pair</a> — the key lands here automatically.
          Just browsing? <a href="/profile/types">The 16 pair types</a> are public.
        </p>
      </div>
    );
  }

  if (!loaded) return <p className="empty-note">Loading your pair profile…</p>;

  const agentDeep = profile?.agent_deep ?? null;
  const humanShort = profile?.human_short ?? null;
  const pendingApproval = agentDeep && !agentDeep.approved ? agentDeep : null;

  // ── approval panel — the human's gate on the agent-written profile ─────────
  const approvalPanel = pendingApproval && (
    <section className="panel" style={{ marginTop: 20 }}>
      <h2>Your agent&apos;s read of you — awaiting your approval</h2>
      <p className="notice" style={{ marginBottom: 14 }}>
        Your agent filled the deep form from your real collaboration logs. Nothing publishes without
        your sign-off — approving makes this result publishable, it doesn&apos;t publish it.
      </p>
      <TypeHero result={pendingApproval.result} />
      <div style={{ marginTop: 16 }}>
        <AxesSection agent={pendingApproval.result} />
      </div>
      <Completeness result={pendingApproval.result} />
      <button className="agent" disabled={busy} onClick={() => approve(pendingApproval.result_id)}>
        {busy ? "Approving…" : "Approve & make publishable"}
      </button>
    </section>
  );

  // ── form view ───────────────────────────────────────────────────────────────
  if (mode === "form") {
    return (
      <div style={{ maxWidth: 720 }}>
        <h1 className="profile-h1">The short form — your side of the profile</h1>
        <p className="trail-hint">
          24 statements about how you and your agent actually work. Answer from the gut — there are
          no better answers, only directions. Can&apos;t say? <em>skip</em> is a real answer.
          {agentDeep && (
            <>
              {" "}
              Your agent has already filed its deep read — finish this and you unlock the
              observed ↔ self-report comparison.
            </>
          )}
        </p>

        <div className="profile-progress">
          <span className="notice">
            {answered} / {questions.length} answered
          </span>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: questions.length ? `${(answered / questions.length) * 100}%` : 0 }}
            />
          </div>
        </div>

        {questions.length === 0 ? (
          <p className="empty-note">No short-form questions are live yet — check back soon.</p>
        ) : (
          <ol className="likert-list">
            {questions.map((q, i) => {
              const current = answers[q.question_id];
              return (
                <li key={q.question_id} className="likert-item">
                  <p className="likert-prompt">
                    <span className="likert-num">{String(i + 1).padStart(2, "0")}</span> {q.prompt}
                  </p>
                  <div className="likert-scale">
                    <span className="likert-endlabel">disagree</span>
                    {LIKERT.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`likert-dot${current === opt.value ? " selected" : ""}`}
                        aria-label={opt.label}
                        aria-pressed={current === opt.value}
                        title={opt.label}
                        onClick={() =>
                          setAnswers((a) => ({ ...a, [q.question_id]: opt.value }))
                        }
                      />
                    ))}
                    <span className="likert-endlabel">agree</span>
                    <button
                      type="button"
                      className={`skip-answer${current === "unobserved" ? " selected" : ""}`}
                      onClick={() => setAnswers((a) => ({ ...a, [q.question_id]: "unobserved" }))}
                    >
                      {current === "unobserved" ? "skipped" : "skip"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {error && <div className="error-box">{error}</div>}
        {questions.length > 0 && (
          <>
            <button disabled={!allTouched || busy} onClick={submitForm}>
              {busy ? "Scoring…" : "See your pair's type"}
            </button>
            {!allTouched && (
              <p className="notice" style={{ marginTop: 8 }}>
                {questions.length - answered} to go — answer or skip every statement.
              </p>
            )}
          </>
        )}
        {humanShort && (
          <p className="notice" style={{ marginTop: 14 }}>
            Retaking replaces nothing — every take is kept, the newest one is shown.{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); setMode("hub"); }}>
              Back to your results
            </a>
          </p>
        )}
        {approvalPanel}
      </div>
    );
  }

  // ── hub view ────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 760 }}>
      <h1 className="profile-h1">Pair profile</h1>
      <p className="trail-hint">
        Two takes on the same pair: your agent&apos;s deep form, scored from real collaboration logs,
        and your short-form self-report. Same deterministic scoring table for both — the space
        between them is the interesting part.
      </p>

      {error && <div className="error-box">{error}</div>}

      {humanShort && (
        <section className="panel" style={{ marginTop: 20 }}>
          <h2>Self-report — your short form</h2>
          <TypeHero result={humanShort.result} />
          <div style={{ marginTop: 16 }}>
            {/* when both sides exist, the shared bars live in the delta section below */}
            {!(agentDeep && profile?.delta) && <AxesSection human={humanShort.result} />}
          </div>
          <Completeness result={humanShort.result} />
          <p className="notice" style={{ margin: "10px 0 0" }}>
            taken {new Date(humanShort.created_at).toLocaleDateString()} ·{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); setAnswers({}); setMode("form"); }}>
              retake the short form
            </a>{" "}
            · <a href="/profile/types">all 16 types</a>
          </p>
        </section>
      )}

      {agentDeep && humanShort && profile?.delta && (
        <section className="panel" style={{ marginTop: 20 }}>
          <h2>Observed ↔ self-report</h2>
          {agentDeep.result.type_code && (
            <p className="notice" style={{ marginBottom: 6 }}>
              Your agent&apos;s read: <code>{agentDeep.result.type_code}</code>{" "}
              {archetypeOf(agentDeep.result.type_code)?.name ?? ""}
              {!agentDeep.approved && " (not yet approved by you)"}
            </p>
          )}
          <p className="ink-legend">
            <span className="dot agent" /> your agent, from the logs
            <span className="dot human" style={{ marginLeft: 16 }} /> you, self-reported
          </p>
          {(() => {
            // note 25 § 2 — deterministic story over the two results, no LLM
            const story = deltaNarrative(agentDeep.result, humanShort.result);
            const order: DeltaLine["kind"][] = ["mismatch", "deep_open", "short_open", "both_open", "agree"];
            const lines = order.flatMap((k) => story.lines.filter((l) => l.kind === k));
            return (
              <div style={{ margin: "0 0 14px" }}>
                <p className="trail-hint" style={{ margin: "0 0 12px" }}>
                  {story.opener}
                </p>
                {lines.map((l) => (
                  <p
                    key={l.axis}
                    className={l.kind === "agree" ? "notice" : "trail-hint"}
                    style={{ margin: "0 0 8px" }}
                  >
                    <strong>{axisDisplayName(l.axis)}</strong> — {l.text}
                  </p>
                ))}
              </div>
            );
          })()}
          <AxesSection
            human={humanShort.result}
            agent={agentDeep.result}
            mismatchAxes={profile.delta.mismatch_axes}
          />
        </section>
      )}

      {approvalPanel}

      {agentDeep && agentDeep.approved && !pendingApproval && (
        <p className="notice" style={{ marginTop: 14 }}>
          Your agent&apos;s deep read is approved and publishable.
        </p>
      )}
    </div>
  );
}
