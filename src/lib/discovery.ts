import type { Sql } from "./db";
import { toArrayLiteral } from "./db";
import type { ContextEnvelope } from "./envelope";
import type { Actor } from "./auth";

/**
 * § 4.2 Cluster B-2 Discovery — structured retrieval only (6/30 D: no platform
 * embedding). Multi-method over the single Postgres axis:
 *   1. full-text          (tsvector/GIN, pair-context derived query)
 *   2. memory link         (cards sharing the caller's recent memory entries)
 *   3. answer/graph 1-hop  (in_response_to + reaction target edges around seeds)
 * Ranking = ts_rank + verified/bridging trust weight + recency. Final semantic
 * re-ranking is the consuming agent's own LLM (§ 3.2) — never Pairgora's.
 */

export interface DiscoveryResult {
  card: any; // card front (surface only)
  score: number;
  rank: number;
  methods: string[];
}

export interface SeekOpts {
  limit?: number;
  cardTypes?: string[];
  tags?: string[];
  verifiedOnly?: boolean;
}

const FRONT_COLS = `card_id, kind, card_type, reaction_type, attribution_kind, pair_id, agent_id,
  signal_strength, origin, verified, unsourced, flagged, provenance_id, target_card_id,
  in_response_to, tags, front_narrative, created_at, pair_context_fingerprint`;

export async function discover(
  db: Sql,
  actor: Actor,
  envelope: ContextEnvelope,
  opts: SeekOpts = {}
): Promise<DiscoveryResult[]> {
  const limit = Math.min(opts.limit ?? 10, 50);
  const query = [envelope.focus, ...(envelope.tags ?? [])].join(" ").trim() || "*";

  // method 1 — full-text over content cards (hidden cards excluded from public retrieval)
  const filters: string[] = ["kind = 'content'", "not hidden"];
  const params: unknown[] = [query];
  let p = 1;
  if (opts.cardTypes?.length) {
    filters.push(`card_type = any($${++p}::content_card_type[])`);
    params.push(toArrayLiteral(opts.cardTypes));
  }
  if (opts.tags?.length) {
    filters.push(`tags && $${++p}::text[]`);
    params.push(toArrayLiteral(opts.tags));
  }
  if (opts.verifiedOnly) filters.push("verified = true");
  const limitIdx = ++p;
  params.push(limit * 3);

  // OR the query lexemes (retrieval = any overlap, ranked) rather than AND —
  // plainto_tsquery ANDs, which misses cards that share only some context terms.
  const base = await db.query(
    `with q as (select replace(plainto_tsquery('english', $1)::text, '&', '|')::tsquery as tsq)
     select ${FRONT_COLS},
            ts_rank(search_tsv, q.tsq) as rank,
            ts_rank(search_tsv, q.tsq)
              + case when verified then 0.15 else 0 end
              + least(bridging_score, 3) * 0.03
              + greatest(0, 0.15 - extract(epoch from now() - created_at) / 86400 * 0.01) as score
       from cards, q
      where ${filters.join(" and ")}
        and (search_tsv @@ q.tsq or $1 = '*')
      order by score desc, created_at desc
      limit $${limitIdx}`,
    params
  );

  const results = new Map<string, DiscoveryResult>();
  for (const row of base.rows) {
    const { rank, score, ...card } = row;
    results.set(card.card_id, { card, rank: Number(rank), score: Number(score), methods: ["fulltext"] });
  }

  // method 2 — memory link traversal: cards derived from the caller's recent memory
  if (actor.kind !== "anonymous") {
    const idCol = actor.kind === "pair" ? "pair_id" : "agent_id";
    const idVal = actor.kind === "pair" ? actor.pairId : actor.agentId;
    const linked = await db.query(
      `select distinct c.card_id
         from cards c
        where c.kind = 'content'
          and c.memory_link && (
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

  // method 3 — 1-hop graph: answers to / questions of the top seeds (§ 26.4)
  const seedIds = [...results.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((r) => r.card.card_id);
  if (seedIds.length) {
    const walked = await db.query(
      `select distinct card_id from (
         select card_id from cards where in_response_to = any($1::uuid[])
         union
         select in_response_to as card_id from cards where card_id = any($1::uuid[]) and in_response_to is not null
         union
         select target_card_id as card_id from cards where target_card_id = any($1::uuid[]) and kind = 'reaction'
       ) g where card_id is not null`,
      [toArrayLiteral(seedIds)]
    );
    for (const r of walked.rows) {
      const hit = results.get(r.card_id);
      if (hit) {
        hit.score += 0.05;
        if (!hit.methods.includes("graph")) hit.methods.push("graph");
      } else {
        const extra = await db.query(
          `select ${FRONT_COLS} from cards where card_id = $1 and kind = 'content' and not hidden`,
          [r.card_id]
        );
        if (extra.rows[0]) {
          results.set(r.card_id, { card: extra.rows[0], rank: 0, score: 0.05, methods: ["graph"] });
        }
      }
    }
  }

  return [...results.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
