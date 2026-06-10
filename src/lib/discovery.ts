import type { Sql } from "./db";
import { toVectorLiteral, toArrayLiteral } from "./db";
import { embed } from "./embeddings";
import type { ContextEnvelope } from "./envelope";
import { envelopeToText } from "./envelope";
import type { Actor } from "./auth";

/**
 * § 4.2 Cluster B-2 Discovery — multi-method retrieval over the single
 * Postgres axis:
 *   1. embedding similarity        (pgvector cosine)
 *   2. memory link traversal       (cards sharing the caller's memory entries)
 *   3. provenance graph walk       (target_card_id edges around seed matches)
 * Ranking = similarity + trust signal weight + recency + signal-type fit
 * (§ 4.2 ranking inputs), with bonuses when methods 2/3 corroborate.
 */

export interface DiscoveryResult {
  card: any; // card front (surface only)
  score: number;
  similarity: number;
  methods: string[];
}

const SCORE_SQL = `
  (1 - (e.embedding <=> $1::vector))                                   -- similarity
  + least(c.signal_count, 10) * 0.03
      * case c.signal_strength when 'strong' then 1.0 else 0.5 end     -- trust weight
  + greatest(0, 0.15 - extract(epoch from now() - c.created_at) / 86400 * 0.01) -- recency
`;

export async function discover(
  db: Sql,
  actor: Actor,
  envelope: ContextEnvelope,
  opts: { limit?: number; typeFit?: string[] } = {}
): Promise<DiscoveryResult[]> {
  const limit = Math.min(opts.limit ?? 10, 50);
  const { embedding } = await embed(envelopeToText(envelope));
  const vec = toVectorLiteral(embedding);

  // method 1 — embedding similarity over card fronts
  const base = await db.query(
    `select c.*, (1 - (e.embedding <=> $1::vector)) as similarity, (${SCORE_SQL}) as score
       from card_fronts c
       join embeddings e on e.card_id = c.card_id
       ${opts.typeFit?.length ? "where c.type = any($3::card_type[])" : ""}
      order by score desc
      limit $2`,
    opts.typeFit?.length ? [vec, limit * 3, toArrayLiteral(opts.typeFit)] : [vec, limit * 3]
  );

  const results = new Map<string, DiscoveryResult>();
  for (const row of base.rows) {
    const { similarity, score, ...card } = row;
    results.set(card.card_id, { card, similarity: Number(similarity), score: Number(score), methods: ["embedding"] });
  }

  // method 2 — memory link traversal: cards derived from memory entries of
  // the caller's own pair history (cross-pair: entries semantically shared)
  if (actor.kind !== "anonymous") {
    const idCol = actor.kind === "pair" ? "pair_id" : "agent_id";
    const idVal = actor.kind === "pair" ? actor.pairId : actor.agentId;
    const linked = await db.query(
      `select distinct c.card_id
         from cards c
        where c.memory_link && (
                select coalesce(array_agg(m.memory_id), '{}')
                  from memory_entries m
                 where m.${idCol} = $1
                   and m.created_at > now() - interval '7 days')
        limit 50`,
      [idVal]
    );
    for (const r of linked.rows) {
      const hit = results.get(r.card_id);
      if (hit) {
        hit.score += 0.1;
        hit.methods.push("memory_link");
      }
    }
  }

  // method 3 — provenance graph walk: cards connected to top seeds via
  // target_card_id edges (signals/counterexamples/caveats), both directions
  const seedIds = [...results.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((r) => r.card.card_id);
  if (seedIds.length) {
    const walked = await db.query(
      `with recursive walk(card_id, depth) as (
         select card_id, 0 from cards where card_id = any($1::uuid[])
         union
         select case when c.card_id = w.card_id then c.target_card_id else c.card_id end, w.depth + 1
           from walk w
           join cards c on (c.card_id = w.card_id or c.target_card_id = w.card_id)
          where w.depth < 2 and c.target_card_id is not null
       )
       select distinct card_id from walk where depth > 0 and card_id is not null`,
      [toArrayLiteral(seedIds)]
    );
    for (const r of walked.rows) {
      const hit = results.get(r.card_id);
      if (hit) {
        hit.score += 0.05;
        if (!hit.methods.includes("provenance_walk")) hit.methods.push("provenance_walk");
      } else {
        const extra = await db.query(`select * from card_fronts where card_id = $1`, [r.card_id]);
        if (extra.rows[0]) {
          results.set(r.card_id, {
            card: extra.rows[0],
            similarity: 0,
            score: 0.05,
            methods: ["provenance_walk"],
          });
        }
      }
    }
  }

  return [...results.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
