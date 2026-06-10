"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * § 15.3 Step 3 — per-pair session view.
 * Agent story (LLM summary) + steering hooks · activity timeline (Realtime
 * channel pair:{pair_id}:activity, polling fallback) · value layer indicators.
 */

interface TimelineRow {
  activity_id: string;
  at: string;
  activity_type: string;
  narrative: string;
  card_id: string | null;
}

interface Narrative {
  agent_story: string;
  story_source: string;
  timeline: TimelineRow[];
  value_layers: { outcome: number; trust: number; choice: number; control: number };
}

export default function PairSessionPage() {
  const [pairId, setPairId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [narrative, setNarrative] = useState<Narrative | null>(null);
  const [live, setLive] = useState<"realtime" | "polling" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steerNote, setSteerNote] = useState("");
  const lastAt = useRef<string | null>(null);

  useEffect(() => {
    setPairId(localStorage.getItem("chaldduk_pair_id"));
    setApiKey(localStorage.getItem("chaldduk_pair_key"));
  }, []);

  const loadNarrative = useCallback(async () => {
    if (!pairId || !apiKey) return;
    const res = await fetch(`/api/v1/pairs/${pairId}/narrative`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "failed to load narrative");
      return;
    }
    setNarrative(data);
    const last = data.timeline[data.timeline.length - 1];
    if (last) lastAt.current = last.at;
  }, [pairId, apiKey]);

  // initial load
  useEffect(() => {
    loadNarrative();
  }, [loadNarrative]);

  // live updates: Supabase Realtime if configured, else polling (§ 15.3)
  useEffect(() => {
    if (!pairId || !apiKey) return;
    let cleanup = () => {};
    let cancelled = false;

    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supaKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (supaUrl && supaKey) {
      import("@supabase/supabase-js").then(({ createClient }) => {
        if (cancelled) return;
        const supabase = createClient(supaUrl, supaKey);
        const channel = supabase
          .channel(`pair:${pairId}:activity`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "activities", filter: `pair_id=eq.${pairId}` },
            () => loadNarrative()
          )
          .subscribe((status) => {
            if (status === "SUBSCRIBED") setLive("realtime");
          });
        cleanup = () => supabase.removeChannel(channel);
      });
    } else {
      setLive("polling");
      const t = setInterval(async () => {
        const url = new URL(`/api/v1/pairs/${pairId}/activities`, window.location.origin);
        if (lastAt.current) url.searchParams.set("after", lastAt.current);
        const res = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` } });
        const data = await res.json();
        if (res.ok && data.activities.length > 0) loadNarrative();
      }, 4000);
      cleanup = () => clearInterval(t);
    }
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [pairId, apiKey, loadNarrative]);

  async function steer(action: "keep" | "discard" | "steer") {
    if (!pairId || !apiKey) return;
    await fetch(`/api/v1/pairs/${pairId}/steer`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ action, note: steerNote || undefined }),
    });
    setSteerNote("");
    loadNarrative();
  }

  if (pairId === null && apiKey === null && !narrative) {
    return (
      <div className="form-card">
        <h1>No pair in this browser</h1>
        <p className="notice">
          Register a pair first — the session view opens automatically afterwards.
        </p>
        <a href="/register">
          <button>Register your pair →</button>
        </a>
      </div>
    );
  }

  return (
    <div className="session-grid">
      <h1 style={{ margin: 0 }}>
        Your pair, at work{" "}
        {live && (
          <span className="notice">
            <span className="live-dot" />
            {live === "realtime" ? "live (Supabase Realtime)" : "live (polling)"}
          </span>
        )}
      </h1>
      {error && <div className="error-box">{error}</div>}

      <section className="panel">
        <h2>Agent story — this session</h2>
        <p className="agent-story">{narrative?.agent_story ?? "Loading…"}</p>
        <div className="steering">
          <button onClick={() => steer("keep")}>keep</button>
          <button className="ghost" onClick={() => steer("discard")}>
            discard
          </button>
          <button className="ghost" onClick={() => steer("steer")}>
            steer
          </button>
          <input
            value={steerNote}
            onChange={(e) => setSteerNote(e.target.value)}
            placeholder="optional steering note → becomes pair memory"
            style={{ marginTop: 0 }}
          />
        </div>
      </section>

      <section className="panel">
        <h2>Activity timeline</h2>
        {narrative && narrative.timeline.length === 0 && (
          <p className="notice">
            Quiet so far. Point your agent at <code>/api/mcp</code> with your pair key and the trail
            starts here, live.
          </p>
        )}
        <ul className="timeline">
          {narrative?.timeline.map((r) => (
            <li key={r.activity_id}>
              <span className="t">{new Date(r.at).toLocaleTimeString()}</span>
              <span className={`kind kind-${r.activity_type}`}>{r.activity_type}</span>
              <span>
                {r.narrative}
                {r.card_id && (
                  <>
                    {" "}
                    <a href={`/api/v1/cards/${r.card_id}`} target="_blank">
                      card ↗
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Value layers — Outcome · Trust · Choice · Control</h2>
        <div className="value-layers">
          <div className="vl">
            <div className="num">{narrative?.value_layers.outcome ?? "–"}</div>
            <div className="lbl">Outcome</div>
          </div>
          <div className="vl">
            <div className="num">{narrative?.value_layers.trust ?? "–"}</div>
            <div className="lbl">Trust</div>
          </div>
          <div className="vl">
            <div className="num">{narrative?.value_layers.choice ?? "–"}</div>
            <div className="lbl">Choice</div>
          </div>
          <div className="vl">
            <div className="num">{narrative?.value_layers.control ?? "–"}</div>
            <div className="lbl">Control</div>
          </div>
        </div>
      </section>
    </div>
  );
}
