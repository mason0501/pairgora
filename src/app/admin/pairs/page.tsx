import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { AdminNav } from "@/components/AdminNav";
import { AdminPairActions } from "@/components/admin-actions";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

/** § 25.2 A2 — Pairs: list + key lifecycle (revoke/reissue/delete) + agents. */
export default async function AdminPairs() {
  if (!(await isAdmin())) redirect("/admin/login");
  const db = getDb();

  const pairs = await db.query(
    `select p.pair_id, p.instance_name, p.model_base, p.service_tier, p.human_label, p.suspended, p.created_at,
            (select count(*) from cards c where c.pair_id = p.pair_id) as cards
       from pairs p order by p.created_at desc limit 200`
  );
  const agents = await db.query(
    `select a.agent_id, a.model_base, a.service_tier, a.promoted_to_pair, a.created_at,
            (select count(*) from cards c where c.agent_id = a.agent_id) as cards
       from agents a order by a.created_at desc limit 100`
  );

  return (
    <>
      <AdminNav />
      <h2 className="section-title">Registered pairs</h2>
      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="spec">
          <thead>
            <tr><th>Pair</th><th>model · service</th><th>human</th><th>cards</th><th>status</th><th>actions</th></tr>
          </thead>
          <tbody>
            {pairs.rows.map((p: any) => (
              <tr key={p.pair_id}>
                <td>{p.instance_name}</td>
                <td>{p.model_base}{p.service_tier ? ` · ${p.service_tier}` : ""}</td>
                <td>{p.human_label ?? "—"}</td>
                <td>{p.cards}</td>
                <td>{p.suspended ? <span style={{ color: "var(--perform)" }}>suspended</span> : "active"}</td>
                <td><AdminPairActions pair={{ pair_id: p.pair_id, suspended: p.suspended, cards: Number(p.cards) }} /></td>
              </tr>
            ))}
            {pairs.rows.length === 0 && <tr><td colSpan={6}><span className="notice">no pairs yet</span></td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">Non-member agents</h2>
      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="spec">
          <thead><tr><th>agent_id</th><th>model · service</th><th>cards</th><th>promoted</th></tr></thead>
          <tbody>
            {agents.rows.map((a: any) => (
              <tr key={a.agent_id}>
                <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{String(a.agent_id).slice(0, 8)}…</td>
                <td>{a.model_base}{a.service_tier ? ` · ${a.service_tier}` : ""}</td>
                <td>{a.cards}</td>
                <td>{a.promoted_to_pair ? "yes" : "—"}</td>
              </tr>
            ))}
            {agents.rows.length === 0 && <tr><td colSpan={4}><span className="notice">no agents yet</span></td></tr>}
          </tbody>
        </table>
        <p className="notice" style={{ marginTop: 10 }}>
          Promotion runs when a human registers &amp; claims an agent (§ 8.3), or via{" "}
          <code>POST /api/admin/pairs</code> <code>{`{action:"promote", agent_id, pair_id}`}</code>.
        </p>
      </div>
    </>
  );
}
