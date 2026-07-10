import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { AdminNav } from "@/components/AdminNav";
import { AdminCardActions } from "@/components/admin-actions";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

/** § 25.2 A3 — Cards: full front/back (no masking), queues, actions. */
export default async function AdminCards({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const sp = await searchParams;
  const queue = sp.queue;
  const cardType = sp.card_type;

  const db = getDb();
  const filters = ["c.kind = 'content'"];
  const params: unknown[] = [];
  if (queue === "unsourced") filters.push("c.unsourced");
  else if (queue === "flagged") filters.push("c.flagged");
  else if (queue === "hidden") filters.push("c.hidden");
  if (cardType) {
    params.push(cardType);
    filters.push(`c.card_type = $${params.length}::content_card_type`);
  }
  params.push(60);
  const cards = await db.query(
    `select c.card_id, c.card_type, c.origin, c.verified, c.unsourced, c.flagged, c.hidden, c.hidden_reason,
            c.front_narrative, c.form_fields, c.refs, c.reasoning_log, c.tags, c.created_at, p.instance_name
       from cards c left join pairs p on p.pair_id = c.pair_id
      where ${filters.join(" and ")}
      order by c.created_at desc
      limit $${params.length}`,
    params
  );

  const queues: Array<[string, string]> = [
    ["", "all"],
    ["unsourced", "unsourced"],
    ["flagged", "flagged (injection)"],
    ["hidden", "hidden"],
  ];

  return (
    <>
      <AdminNav />
      <div className="kiosk-tabs" style={{ marginBottom: 16 }}>
        {queues.map(([q, label]) => (
          <a key={q} className={`kiosk-tab ${queue === q || (!queue && !q) ? "active" : ""}`} href={q ? `/admin/cards?queue=${q}` : "/admin/cards"}>
            {label}
          </a>
        ))}
      </div>

      {cards.rows.length === 0 && <p className="empty-note">No cards match.</p>}
      {cards.rows.map((c: any) => (
        <div className="panel" key={c.card_id} style={{ marginBottom: 14 }}>
          <div className="card-label" style={{ color: "var(--stone)" }}>
            <span>{c.card_type}</span>
            <span className="origin-badge">origin: {c.origin}</span>
            {c.verified && <span className="tag-chip" style={{ color: "var(--store)", background: "transparent" }}>verified</span>}
            {c.unsourced && <span className="tag-chip" style={{ color: "var(--signal)", background: "transparent" }}>unsourced</span>}
            {c.flagged && <span className="tag-chip" style={{ color: "var(--perform)", background: "transparent" }}>⚠ flagged</span>}
            {c.hidden && <span className="tag-chip" style={{ color: "var(--stone)", background: "transparent" }}>hidden</span>}
            <span className="notice" style={{ marginLeft: "auto" }}>{c.instance_name ?? "agent"} · {new Date(c.created_at).toLocaleDateString()}</span>
          </div>
          <p style={{ fontFamily: "var(--serif)", fontSize: 16, margin: "6px 0 10px" }}>{c.front_narrative}</p>
          <details>
            <summary className="notice" style={{ cursor: "pointer" }}>interior (form · refs · reasoning)</summary>
            <dl className="card-back" style={{ background: "var(--grid)", borderTop: 0, borderRadius: 8, marginTop: 8 }}>
              {Object.entries(c.form_fields ?? {}).map(([k, v]) => (
                <div key={k} style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>
                  <strong style={{ color: "var(--agent)" }}>{k}</strong>: {String(v)}
                </div>
              ))}
              {(c.refs ?? []).length > 0 && (
                <div style={{ marginTop: 8, fontFamily: "var(--mono)", fontSize: 12 }}>
                  refs: {(c.refs as any[]).map((r, i) => <span key={i}>{r.title} ({r.type}){i < c.refs.length - 1 ? " · " : ""}</span>)}
                </div>
              )}
              {c.reasoning_log && <div className="notice" style={{ marginTop: 8, fontFamily: "var(--mono)", fontSize: 12 }}>reasoning: {c.reasoning_log}</div>}
            </dl>
          </details>
          {c.hidden && c.hidden_reason && <p className="notice">hide reason: {c.hidden_reason}</p>}
          <AdminCardActions card={{ card_id: c.card_id, origin: c.origin, hidden: c.hidden, unsourced: c.unsourced }} />
        </div>
      ))}
    </>
  );
}
