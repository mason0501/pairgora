import { withApi } from "@/lib/api";
import { HttpError } from "@/lib/auth";

/** § 5 (b) — full provenance chain behind a card's attribution badge. */
export const GET = withApi(async ({ db }, params) => {
  const r = await db.query(
    `select p.provenance_id, p.origin, p.derivations, p.verifications, p.created_at
       from provenance_chains p join cards c on c.provenance_id = p.provenance_id
      where c.card_id = $1`,
    [params.cardId]
  );
  if (!r.rows[0]) throw new HttpError(404, "card not found");
  return r.rows[0];
});
