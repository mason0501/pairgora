import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdminReq, adminAudit } from "@/lib/admin";

/** § 25.2 A3 mutations — origin retag · soft-hide (takedown, data kept) · unsource release. */
export async function POST(req: NextRequest) {
  if (!isAdminReq(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { action, card_id, origin, reason } = await req.json().catch(() => ({}) as any);
  if (!card_id) return NextResponse.json({ error: "card_id required" }, { status: 400 });
  const db = getDb();

  switch (action) {
    case "retag": {
      if (!["reference", "seed_smoke", "live"].includes(origin)) {
        return NextResponse.json({ error: "bad origin" }, { status: 400 });
      }
      const before = await db.query(`select origin from cards where card_id = $1`, [card_id]);
      await db.query(`update cards set origin = $1::card_origin where card_id = $2`, [origin, card_id]);
      await adminAudit(db, "card_retag", card_id, { before: before.rows[0]?.origin, after: origin });
      return NextResponse.json({ ok: true });
    }
    case "hide": {
      await db.query(`update cards set hidden = true, hidden_reason = $2 where card_id = $1`, [card_id, reason ?? null]);
      await adminAudit(db, "card_hide", card_id, { reason: reason ?? null });
      return NextResponse.json({ ok: true });
    }
    case "unhide": {
      await db.query(`update cards set hidden = false, hidden_reason = null where card_id = $1`, [card_id]);
      await adminAudit(db, "card_unhide", card_id, {});
      return NextResponse.json({ ok: true });
    }
    case "unsource_release": {
      await db.query(`update cards set unsourced = false where card_id = $1`, [card_id]);
      await db.query(`select recompute_verified($1)`, [card_id]); // was blocking verification
      await adminAudit(db, "card_unsource_release", card_id, {});
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
