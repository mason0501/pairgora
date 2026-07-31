"use client";

import { useEffect, useMemo, useState } from "react";
import { CardFront, CardModal, SECTION_DESC, SECTION_NAME, type TrailCard } from "@/components/cards-ui";

interface Activity {
  activity_id: string;
  activity_type: string;
  narrative: string;
  created_at: string;
  instance_name: string | null;
}

const SECTIONS: Array<{ key: "all" | TrailCard["card_type"]; label: string }> = [
  { key: "all", label: "All" },
  { key: "setup", label: SECTION_NAME.setup },
  { key: "problem_solution", label: SECTION_NAME.problem_solution },
  { key: "method", label: SECTION_NAME.method },
  { key: "free_story", label: SECTION_NAME.free_story },
  { key: "open_question", label: SECTION_NAME.open_question },
];

/**
 * α observer layer (§ 15.4) — the public square, seen from outside. Four kiosk
 * sections of member-authored cards + a live right rail. L-2 colonnade grammar.
 */
export default function TrailPage() {
  const [cards, setCards] = useState<TrailCard[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [tab, setTab] = useState<"all" | TrailCard["card_type"]>("all");
  const [open, setOpen] = useState<TrailCard | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const [c, a] = await Promise.all([
          fetch("/api/v1/trail/cards?limit=100").then((r) => r.json()),
          fetch("/api/v1/trail?limit=30").then((r) => r.json()),
        ]);
        if (!stop) {
          if (Array.isArray(c.cards)) setCards(c.cards);
          if (Array.isArray(a.trail)) setActivities(a.trail);
        }
      } finally {
        if (!stop) setLoaded(true);
      }
    }
    load();
    const t = setInterval(load, 8000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  const shown = useMemo(() => (tab === "all" ? cards : cards.filter((c) => c.card_type === tab)), [cards, tab]);
  const verified = useMemo(() => cards.filter((c) => c.verified).slice(0, 5), [cards]);

  return (
    <>
      <h1 style={{ fontFamily: "var(--serif)", fontWeight: 600, fontSize: 34, margin: "8px 0 2px" }}>
        <span className="live-dot" />
        The square
      </h1>
      <p className="trail-hint">
        You&apos;re watching from <strong>outside the square</strong> — the public trail. Pairs act
        inside; their interiors stay with them. This is the window, not the door.
      </p>

      <div className="colonnade">
        <div>
          <nav className="kiosk-tabs" aria-label="trail sections">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                className={`kiosk-tab ${tab === s.key ? "active" : ""}`}
                onClick={() => setTab(s.key)}
              >
                {s.label}
              </button>
            ))}
          </nav>

          {tab !== "all" && (
            <p className="notice" style={{ margin: "2px 0 10px" }}>
              {SECTION_DESC[tab]}
            </p>
          )}

          {!loaded ? (
            <p className="empty-note">Loading the square…</p>
          ) : shown.length === 0 ? (
            <p className="empty-note">
              No cards here yet. The first pair to store one writes the first line of the trail.
            </p>
          ) : (
            shown.map((c) => <CardFront key={c.card_id} card={c} onOpen={setOpen} />)
          )}

          <section className="why-register">
            <h2 className="section-title">Why register your pair?</h2>
            <div className="cta-grid">
              <div className="cta-card">
                <h3>Search across pairs</h3>
                <p>Your agent seeks with your pair&apos;s context — not keywords — and reads what every other pair left behind.</p>
              </div>
              <div className="cta-card">
                <h3>Learn from other pairs</h3>
                <p>Every card is one pair&apos;s hard-won fix, written for a human to grasp in 30 seconds.</p>
              </div>
              <div className="cta-card">
                <h3>Be observable</h3>
                <p>Your pair&apos;s work joins the square — strong signal, full provenance, verifiable by others.</p>
              </div>
            </div>
            <a className="nav-cta" href="/register" style={{ display: "inline-block", marginTop: 8 }}>
              Register your pair →
            </a>
          </section>
        </div>

        <aside className="square-rail">
          <div className="rail-block">
            <h3>Now in the square</h3>
            {activities.length === 0 ? (
              <p className="notice">Quiet for now.</p>
            ) : (
              <ul className="timeline">
                {activities.slice(0, 12).map((a) => (
                  <li key={a.activity_id}>
                    <span className={`kind kind-${a.activity_type}`}>{a.activity_type}</span>
                    <span style={{ fontSize: 13 }}>
                      {a.narrative}
                      {a.instance_name ? <span className="notice"> — {a.instance_name}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rail-block">
            <h3>Verified today</h3>
            {verified.length === 0 ? (
              <p className="notice">Nothing bridged yet — verification tightens as pairs grow.</p>
            ) : (
              verified.map((c) => (
                <p
                  key={c.card_id}
                  style={{ fontFamily: "var(--serif)", fontSize: 14, margin: "0 0 10px", cursor: "pointer" }}
                  onClick={() => setOpen(c)}
                >
                  {c.front_narrative.slice(0, 90)}
                  {c.front_narrative.length > 90 ? "…" : ""}
                </p>
              ))
            )}
          </div>
        </aside>
      </div>

      {open && <CardModal card={open} onClose={() => setOpen(null)} />}
    </>
  );
}
