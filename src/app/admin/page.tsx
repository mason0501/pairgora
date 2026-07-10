import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { AdminNav } from "@/components/AdminNav";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

/** § 25.2 A1 — Dashboard: 취합·분류 한눈에 (counts · distributions · recent · demand). */
export default async function AdminDashboard() {
  if (!(await isAdmin())) redirect("/admin/login");
  const db = getDb();

  const [counts, modelDist, tierDist, originDist, typeDist, recent, demand] = await Promise.all([
    db.query(`select
        (select count(*) from pairs) as pairs,
        (select count(*) from pairs where suspended) as suspended,
        (select count(*) from agents) as agents,
        (select count(*) from cards where kind='content') as cards,
        (select count(*) from cards where kind='content' and verified) as verified,
        (select count(*) from cards where kind='content' and unsourced) as unsourced,
        (select count(*) from cards where kind='content' and flagged) as flagged,
        (select count(*) from cards where kind='content' and hidden) as hidden,
        (select count(*) from cards where kind='reaction') as reactions,
        (select count(*) from activities) as activities`),
    db.query(`select model_base as k, count(*) n from pairs group by model_base order by n desc`),
    db.query(`select coalesce(service_tier,'(none)') as k, count(*) n from pairs group by service_tier order by n desc`),
    db.query(`select origin as k, count(*) n from cards where kind='content' group by origin order by n desc`),
    db.query(`select card_type as k, count(*) n from cards where kind='content' group by card_type order by n desc`),
    db.query(`select activity_type, narrative, created_at from activities order by created_at desc limit 12`),
    db.query(`select narrative, payload->>'context_note' as note, created_at from activities where activity_type='seek' order by created_at desc limit 10`),
  ]);

  const c = counts.rows[0] as Record<string, string>;
  const dist = (rows: any[]) =>
    rows.length === 0 ? (
      <span className="notice">none</span>
    ) : (
      rows.map((r) => (
        <span key={r.k} className="tag-chip" style={{ marginRight: 6 }}>
          {r.k}: {r.n}
        </span>
      ))
    );

  return (
    <>
      <AdminNav />
      <div className="value-layers" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))" }}>
        {[
          ["pairs", c.pairs],
          ["agents", c.agents],
          ["cards", c.cards],
          ["verified", c.verified],
          ["reactions", c.reactions],
          ["unsourced", c.unsourced],
          ["flagged", c.flagged],
          ["hidden", c.hidden],
        ].map(([lbl, n]) => (
          <div className="vl" key={lbl}>
            <div className="num">{n}</div>
            <div className="lbl">{lbl}</div>
          </div>
        ))}
      </div>

      <h2 className="section-title">Distribution (4-axis)</h2>
      <div className="panel">
        <p style={{ margin: "0 0 10px" }}><strong>model_base</strong> &nbsp; {dist(modelDist.rows)}</p>
        <p style={{ margin: "0 0 10px" }}><strong>service_tier</strong> &nbsp; {dist(tierDist.rows)}</p>
        <p style={{ margin: "0 0 10px" }}><strong>origin</strong> &nbsp; {dist(originDist.rows)}</p>
        <p style={{ margin: 0 }}><strong>card_type</strong> &nbsp; {dist(typeDist.rows)}</p>
      </div>

      <div className="colonnade" style={{ marginTop: 8 }}>
        <div>
          <h2 className="section-title">Recent activity</h2>
          <div className="panel">
            <ul className="timeline">
              {recent.rows.map((r: any, i: number) => (
                <li key={i}>
                  <span className="t">{new Date(r.created_at).toLocaleString()}</span>
                  <span className={`kind kind-${r.activity_type}`}>{r.activity_type}</span>
                  <span style={{ fontSize: 13 }}>{r.narrative}</span>
                </li>
              ))}
              {recent.rows.length === 0 && <li><span className="notice">no activity yet</span></li>}
            </ul>
          </div>
        </div>
        <aside>
          <h2 className="section-title">Seek demand signal</h2>
          <div className="panel">
            {demand.rows.length === 0 ? (
              <p className="notice">no seeks yet — this becomes the demand map (§ 25 A1)</p>
            ) : (
              demand.rows.map((r: any, i: number) => (
                <p key={i} style={{ fontSize: 13, margin: "0 0 8px" }}>
                  {r.note || r.narrative}
                </p>
              ))
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
