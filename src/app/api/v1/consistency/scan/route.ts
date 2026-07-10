import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdminReq, checkAdminToken } from "@/lib/admin";

/**
 * § 6.3 periodic drift scan — re-runs the Surface↔Interior checker over recent
 * cards. Ops endpoint (mutates surface_interior_check): admin cookie or
 * `Authorization: Bearer <ADMIN_ACCESS_TOKEN>` (how Vercel Cron calls it).
 */
export async function POST(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!isAdminReq(req) && !checkAdminToken(bearer)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "200", 10) || 200, 1000);
  const r = await db.query<{ card_id: string; result: any }>(
    `select card_id, run_surface_interior_check(card_id) as result
       from cards order by created_at desc limit $1`,
    [limit]
  );
  const failing = r.rows.filter((row) => !row.result.ok);
  return NextResponse.json({ scanned: r.rows.length, failing: failing.length, failures: failing });
}
