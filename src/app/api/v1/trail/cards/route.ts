import { withApi } from "@/lib/api";
import { toArrayLiteral } from "@/lib/db";

/**
 * Public content-card feed for /trail (§ 15.4 four sections). Surface only —
 * front + attribution + verified/origin + a qualitative reaction list (no
 * counts, § 4.3.4). Interiors stay with their pairs (fetch a single card via
 * /api/v1/cards/[id], which applies the § 7 masking policy).
 */
export const GET = withApi(async ({ db, req }) => {
  const sp = req.nextUrl.searchParams;
  const cardType = sp.get("card_type");
  const limit = Math.min(parseInt(sp.get("limit") ?? "40", 10) || 40, 100);

  const params: unknown[] = [];
  let where = "c.kind = 'content' and not c.hidden";
  if (cardType) {
    params.push(cardType);
    where += ` and c.card_type = $${params.length}::content_card_type`;
  }
  params.push(limit);

  const cards = await db.query(
    `select c.card_id, c.card_type, c.front_narrative, c.verified, c.origin, c.unsourced, c.flagged,
            c.tags, c.in_response_to, c.created_at, c.attribution_kind,
            p.pair_id, p.instance_name, p.model_base, p.service_tier
       from cards c
       left join pairs p on p.pair_id = c.pair_id
      where ${where}
      order by c.created_at desc
      limit $${params.length}`,
    params
  );

  const ids = cards.rows.map((r: any) => r.card_id);
  const byCard: Record<string, unknown[]> = {};
  if (ids.length) {
    const rx = await db.query(
      `select t.card_id, t.reaction_type, t.polarity, t.payload->>'note' as note, rp.instance_name
         from trust_signals t
         left join pairs rp on rp.pair_id = t.actor_pair_id
        where t.card_id = any($1::uuid[])
        order by t.created_at asc`,
      [toArrayLiteral(ids)]
    );
    for (const r of rx.rows as any[]) (byCard[r.card_id] ??= []).push(r);
  }

  return { cards: cards.rows.map((c: any) => ({ ...c, reactions: byCard[c.card_id] ?? [] })) };
});
