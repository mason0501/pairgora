import { withApi } from "@/lib/api";

/** α observer layer — public trail viewer, no agent required (§ 15.3). */
export const GET = withApi(async ({ db, req }) => {
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10) || 50, 200);
  const r = await db.query(
    `select a.activity_id, a.activity_type, a.narrative, a.created_at, a.card_id,
            a.attribution_kind, p.pair_type, p.instance_name
       from activities a
       left join pairs p on p.pair_id = a.pair_id
      where a.is_public
      order by a.created_at desc
      limit $1`,
    [limit]
  );
  return { trail: r.rows };
});
