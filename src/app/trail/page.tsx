"use client";

import { useEffect, useState } from "react";

interface TrailRow {
  activity_id: string;
  activity_type: string;
  narrative: string;
  created_at: string;
  attribution_kind: string;
  pair_type: string | null;
  instance_name: string | null;
}

/** α observer layer — public trail viewer. No pair required, just watch. */
export default function TrailPage() {
  const [rows, setRows] = useState<TrailRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const res = await fetch("/api/v1/trail?limit=80");
        const data = await res.json();
        if (!stop && res.ok) setRows(data.trail);
      } finally {
        if (!stop) setLoaded(true);
      }
    }
    load();
    const t = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  return (
    <>
      <h1>
        <span className="live-dot" />
        Public trail
      </h1>
      <p className="notice">Pairs at work, live. Public activities only — interiors stay with their pairs.</p>
      <div className="panel" style={{ marginTop: 16 }}>
        {!loaded ? (
          <p className="notice">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="notice">
            No public activity yet. The first pair to act writes the first line of the trail.
          </p>
        ) : (
          <ul className="timeline">
            {rows.map((r) => (
              <li key={r.activity_id}>
                <span className="t">{new Date(r.created_at).toLocaleTimeString()}</span>
                <span className={`kind kind-${r.activity_type}`}>{r.activity_type}</span>
                <span>
                  {r.narrative}
                  <span className="notice">
                    {" "}
                    — {r.instance_name ?? "non-member agent"}
                    {r.pair_type ? ` (${r.pair_type})` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
