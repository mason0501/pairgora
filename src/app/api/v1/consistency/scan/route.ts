import { withApi } from "@/lib/api";

/**
 * § 6.3 periodic drift scan — re-runs the Surface↔Interior checker over
 * recent cards. Wire to Vercel Cron (or any scheduler) on deploy.
 */
export const POST = withApi(async ({ db, req }) => {
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "200", 10) || 200, 1000);
  const r = await db.query<{ card_id: string; result: any }>(
    `select card_id, run_surface_interior_check(card_id) as result
       from cards order by created_at desc limit $1`,
    [limit]
  );
  const failing = r.rows.filter((row) => !row.result.ok);
  return { scanned: r.rows.length, failing: failing.length, failures: failing };
});
