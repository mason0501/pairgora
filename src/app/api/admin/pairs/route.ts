import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdminReq, adminAudit } from "@/lib/admin";
import { issueApiKey } from "@/lib/apikey";
import { promoteAgent } from "@/lib/pairs";

/** § 25.2 A2 mutations — key revoke (suspend) · reissue (§ 26.2) · smoke delete · manual promotion. */
export async function POST(req: NextRequest) {
  if (!isAdminReq(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { action, pair_id, agent_id } = await req.json().catch(() => ({}) as any);
  const db = getDb();

  switch (action) {
    case "revoke": {
      await db.query(`update pairs set suspended = true where pair_id = $1`, [pair_id]);
      await adminAudit(db, "pair_revoke", pair_id, {});
      return NextResponse.json({ ok: true });
    }
    case "unrevoke": {
      await db.query(`update pairs set suspended = false where pair_id = $1`, [pair_id]);
      await adminAudit(db, "pair_unrevoke", pair_id, {});
      return NextResponse.json({ ok: true });
    }
    case "reissue": {
      const { key, hash } = issueApiKey("pair");
      const r = await db.query(`update pairs set api_key_hash = $1, suspended = false where pair_id = $2 returning pair_id`, [
        hash,
        pair_id,
      ]);
      if (!r.rows[0]) return NextResponse.json({ error: "pair not found" }, { status: 404 });
      await adminAudit(db, "pair_reissue", pair_id, {});
      return NextResponse.json({ ok: true, api_key: key }); // shown once to the operator
    }
    case "delete": {
      const cards = await db.query(`select count(*) n from cards where pair_id = $1`, [pair_id]);
      if (Number(cards.rows[0].n) > 0) {
        return NextResponse.json(
          { error: "pair has content cards — soft-hide the cards first (content is preserved by policy)" },
          { status: 409 }
        );
      }
      await db.query(`delete from trust_signals where actor_pair_id = $1`, [pair_id]);
      await db.query(`delete from memory_entries where pair_id = $1`, [pair_id]);
      await db.query(`delete from activities where pair_id = $1`, [pair_id]);
      await db.query(`delete from boundary_events where pair_id = $1`, [pair_id]);
      await db.query(`delete from pairs where pair_id = $1`, [pair_id]);
      await adminAudit(db, "pair_delete", pair_id, {});
      return NextResponse.json({ ok: true });
    }
    case "promote": {
      if (!agent_id || !pair_id) return NextResponse.json({ error: "agent_id + pair_id required" }, { status: 400 });
      const result = await promoteAgent(db, agent_id, pair_id);
      await adminAudit(db, "promote", pair_id, { agent_id });
      return NextResponse.json({ ok: true, result });
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
