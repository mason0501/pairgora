import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeTestDb } from "./helpers/db";
import type { Db } from "@/lib/db";
import { registerPair, declareAgent, handshake, promoteAgent } from "@/lib/pairs";
import { resolveActor, type Actor } from "@/lib/auth";
import { seek, store, react, perform, seekSchema, reactSchema, performSchema } from "@/lib/activities";
import { buildNarrative, receiveSteering } from "@/lib/narrative";
import { quotaSnapshot } from "@/lib/quota";

let db: Db;
let close: () => Promise<void>;

let pairActor: Actor; // Mason + Claudi (registered pair, strong signal)
let agentActor: Actor; // non-member single agent (weak signal)
let agentToken: string;
let pairId: string;

const envelope = {
  focus: "patterns for agent-first community retrieval with postgres pgvector",
  recent_artifacts: [{ title: "Pairgora build spec", gist: "pair-context-as-query over single postgres axis" }],
  memory_slice: ["embedding similarity plus provenance walk works well"],
  tags: ["retrieval", "pgvector"],
};

function fullPost(summary: string, content: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    type: "full_post",
    extension: { title: summary.slice(0, 60), body_summary: summary },
    summary,
    full_content: content,
    reasoning_log: "test card registration",
    provenance_origin: { kind: "own_work" },
    context_envelope: envelope,
    store_path: "independent",
    ...extra,
  };
}

beforeAll(async () => {
  ({ db, close } = await makeTestDb());

  const pair = await registerPair(db, {
    pair_type: "claudi_base",
    instance_name: "Mason's Claudi",
    human_label: "Mason",
    context_envelope: envelope as any,
  } as any);
  pairId = pair.pair_id;
  pairActor = await resolveActor(db, `Bearer ${pair.api_key}`);

  const agent = await declareAgent(db, { declared_type: "custom_byoa" });
  agentToken = agent.agent_token;
  agentActor = await resolveActor(db, `Bearer ${agent.agent_token}`);
});

afterAll(async () => {
  await close();
});

// ── § 17.2 gate: Functional — Seek · Store · Signal · React · Perform ───────

describe("functional gate — pair performs all 5 activities end-to-end", () => {
  let storedCardId: string;

  it("registers pair with strong identity (§ 8)", () => {
    expect(pairActor.kind).toBe("pair");
    if (pairActor.kind === "pair") {
      expect(pairActor.instanceName).toBe("Mason's Claudi");
    }
  });

  it("Store — registers a card; single tx writes provenance + embedding + memory", async () => {
    const r = await store(db, pairActor, fullPost(
      "pgvector hnsw beats ivfflat for recall at our scale",
      "Tested hnsw vs ivfflat for 1536-dim embeddings; hnsw recall@10 0.97 vs 0.88. Use hnsw."
    ));
    storedCardId = r.card_id;
    expect(r.signal_strength).toBe("strong");
    expect(r.consistency.ok).toBe(true);

    const emb = await db.query(`select model from embeddings where card_id = $1`, [storedCardId]);
    expect(emb.rows).toHaveLength(1);
    const prov = await db.query(
      `select p.origin from provenance_chains p join cards c on c.provenance_id = p.provenance_id where c.card_id = $1`,
      [storedCardId]
    );
    expect(prov.rows[0].origin.kind).toBe("own_work");
    const mem = await db.query(
      `select m.* from memory_entries m join cards c on m.memory_id = any(c.memory_link) where c.card_id = $1`,
      [storedCardId]
    );
    expect(mem.rows[0].kind).toBe("episodic");
    expect(mem.rows[0].activity_id).not.toBeNull();
  });

  it("Seek — pair-context-as-query returns the stored card (§ 3.2)", async () => {
    const r = await seek(db, pairActor, seekSchema.parse({ envelope, limit: 5 }));
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results.map((x) => x.card.card_id)).toContain(storedCardId);
    expect(r.results[0].methods).toContain("embedding");
  });

  it("Signal — caveat card attaches to target + writes trust signal (§ 15.1)", async () => {
    const r = await store(db, pairActor, {
      ...fullPost("caveat: hnsw build time grows on bulk insert", "when bulk inserting >100k rows, build index after load"),
      type: "caveat",
      extension: { target_card_id: storedCardId, caveat_scope: "when_bulk_loading_then_index_after" },
    });
    expect(r.consistency.ok).toBe(true);
    const t = await db.query(`select * from trust_signals where card_id = $1`, [storedCardId]);
    expect(t.rows.some((x: any) => x.signal_kind === "caveat")).toBe(true);
    const card = await db.query(`select signal_count from cards where card_id = $1`, [storedCardId]);
    expect(card.rows[0].signal_count).toBeGreaterThan(0);
  });

  it("React — verify extends provenance chain + appends verify_log (§ 4.1)", async () => {
    const r = await react(db, pairActor, reactSchema.parse({ card_id: storedCardId, kind: "verify", note: "reproduced" }));
    expect(r.consistency.ok).toBe(true);
    const card = await db.query(`select verify_log from cards where card_id = $1`, [storedCardId]);
    expect(card.rows[0].verify_log.length).toBe(1);
    const prov = await db.query(
      `select p.verifications from provenance_chains p join cards c on c.provenance_id = p.provenance_id where c.card_id = $1`,
      [storedCardId]
    );
    expect(prov.rows[0].verifications.length).toBe(1);
  });

  it("Perform — public trail entry for pairs; restricted for non-members (§ 3.3)", async () => {
    const r = await perform(db, pairActor, performSchema.parse({ note: "shipped the retrieval comparison!" }));
    expect(r.activity_id).toBeTruthy();
    await expect(
      perform(db, agentActor, performSchema.parse({ note: "agent tries to perform" }))
    ).rejects.toThrow(/restricted/i);
  });
});

// ── § 17.2 gate: Boundary — crossings logged, no leakage ────────────────────

describe("boundary gate — input/output crossings logged (§ 1.2)", () => {
  it("registration + handshake logged as input boundary events", async () => {
    const r = await db.query(
      `select event_type, boundary from boundary_events where pair_id = $1 order by created_at`,
      [pairId]
    );
    const types = r.rows.map((x: any) => `${x.boundary}:${x.event_type}`);
    expect(types).toContain("input:pair_registered");
    expect(types).toContain("input:context_handshake");
  });

  it("narrative emission logged as output boundary event", async () => {
    await buildNarrative(db, pairId);
    const r = await db.query(
      `select 1 from boundary_events where pair_id = $1 and boundary = 'output' and event_type = 'narrative_emitted'`,
      [pairId]
    );
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it("handshake updates the context envelope cache (input contract)", async () => {
    const r = await handshake(db, pairActor, { ...envelope, focus: "new focus: shipping day 6" });
    expect(r.ok).toBe(true);
    const p = await db.query(`select context_envelope from pairs where pair_id = $1`, [pairId]);
    expect(p.rows[0].context_envelope.focus).toContain("day 6");
  });
});

// ── § 17.2 gate: Consistency — Surface ↔ Interior (§ 6) ─────────────────────

describe("consistency gate — Surface↔Interior checker", () => {
  it("all registered cards pass the checker", async () => {
    const r = await db.query(`select card_id, run_surface_interior_check(card_id) as result from cards`);
    for (const row of r.rows) expect(row.result.ok, JSON.stringify(row.result)).toBe(true);
  });

  it("detects signal_count drift after manual corruption (§ 6.3 periodic scan)", async () => {
    const c = await db.query(`select card_id from cards limit 1`);
    const cardId = c.rows[0].card_id;
    await db.query(`update cards set signal_count = signal_count + 99 where card_id = $1`, [cardId]);
    const r = await db.query(`select check_surface_interior($1) as result`, [cardId]);
    expect(r.rows[0].result.ok).toBe(false);
    expect(JSON.stringify(r.rows[0].result.issues)).toContain("drift");
    // repair
    await db.query(
      `update cards set signal_count = (select count(*) from trust_signals t where t.card_id = $1) where card_id = $1`,
      [cardId]
    );
  });

  it("DB invariant: card without embedding is rejected at commit (§ 5.2)", async () => {
    await expect(
      db.tx(async (tx) => {
        const prov = await tx.query<{ provenance_id: string }>(
          `insert into provenance_chains (origin) values ('{"kind":"own_work"}') returning provenance_id`
        );
        await tx.query(
          `insert into cards (type, attribution_kind, pair_id, signal_strength, summary, provenance_id,
             pair_context_fingerprint, front_extension, full_content, reasoning_log)
           values ('full_post', 'pair', $1, 'strong', 'no embedding', $2, 'fp',
             '{"title":"x","body_summary":"y"}', 'content', 'r')`,
          [pairId, prov.rows[0].provenance_id]
        );
      })
    ).rejects.toThrow(/without embedding/);
  });

  it("DB invariant: episodic memory must link to an activity", async () => {
    await expect(
      db.query(`insert into memory_entries (kind, pair_id, content) values ('episodic', $1, 'orphan')`, [pairId])
    ).rejects.toThrow();
  });

  it("DB invariant: front extension must match card type (§ 15.1)", async () => {
    await expect(
      store(db, pairActor, {
        ...fullPost("bad extension", "content"),
        type: "outcome_ping",
        extension: { wrong_field: true },
      })
    ).rejects.toThrow();
  });
});

// ── § 17.2 gate: Non-member — independent store + quota (§ 9) ───────────────

describe("non-member gate — 3 paths + quota", () => {
  it("path C: independent store executes for unregistered agent at weak signal", async () => {
    const r = await store(db, agentActor, fullPost(
      "non-member observation: provenance walk surfaces counterexamples",
      "as a weak-signal agent I stored this without any registration",
      { store_path: "independent" }
    ));
    expect(r.signal_strength).toBe("weak");
  });

  it("path B: stored content surfaces for other pairs' Seek (content equality § 9.3)", async () => {
    const r = await seek(db, pairActor, seekSchema.parse({
      envelope: { ...envelope, focus: "provenance walk counterexamples observation non-member" },
      limit: 10,
    }));
    const weak = r.results.find((x) => x.card.signal_strength === "weak");
    expect(weak).toBeTruthy();
    // same schema, same surface — only identity layer differs
    expect(Object.keys(weak!.card)).toContain("summary");
    expect(weak!.card.attribution_kind).toBe("agent");
  });

  it("quota: independent store capped at 2/day, total 5/day (§ 9.2)", async () => {
    // one independent store already used above
    await store(db, agentActor, fullPost("second independent", "content 2", { store_path: "independent" }));
    await expect(
      store(db, agentActor, fullPost("third independent", "content 3", { store_path: "independent" }))
    ).rejects.toThrow(/quota/i);

    // seek-chain path still open (2 used of total 5)
    await store(db, agentActor, fullPost("chain 1", "content", { store_path: "seek_chain" }));
    await store(db, agentActor, fullPost("chain 2", "content", { store_path: "seek_chain" }));
    await store(db, agentActor, fullPost("chain 3", "content", { store_path: "seek_chain" }));
    // total = 5 now → blocked even on chain path
    await expect(
      store(db, agentActor, fullPost("chain 4", "content", { store_path: "seek_chain" }))
    ).rejects.toThrow(/quota/i);

    const snap = await quotaSnapshot(db, (agentActor as any).agentId);
    expect(snap.storeTotalUsed).toBe(5);
  });

  it("quota: seek stays unlimited for non-members (§ 3.3)", async () => {
    const r = await seek(db, agentActor, seekSchema.parse({ envelope, limit: 3 }));
    expect(r.results.length).toBeGreaterThan(0);
  });
});

// ── § 17.2 gate: Promotion — weak → strong, retroactive (§ 8.3) ─────────────

describe("promotion gate — natural promotion", () => {
  it("promotes agent contributions to the pair retroactively + idempotently", async () => {
    const before = await db.query(`select count(*) as n from cards where agent_id = $1 and signal_strength = 'weak'`, [
      (agentActor as any).agentId,
    ]);
    expect(Number(before.rows[0].n)).toBeGreaterThan(0);

    const result = await promoteAgent(db, (agentActor as any).agentId, pairId);
    expect(result.cards_promoted).toBeGreaterThan(0);

    const after = await db.query(
      `select count(*) as n from cards where agent_id = $1 and (signal_strength = 'weak' or attribution_kind = 'agent')`,
      [(agentActor as any).agentId]
    );
    expect(Number(after.rows[0].n)).toBe(0);

    // idempotent: second run changes nothing and does not throw
    const again = await promoteAgent(db, (agentActor as any).agentId, pairId);
    expect(again.cards_promoted).toBe(0);

    // promotion logged as boundary event
    const evt = await db.query(
      `select 1 from boundary_events where event_type = 'promotion' and agent_id = $1`,
      [(agentActor as any).agentId]
    );
    expect(evt.rows.length).toBeGreaterThan(0);
  });
});

// ── § 17.2 gate: Observable — narrative replay (§ 15.3) ─────────────────────

describe("observable gate — Step 3 narrative", () => {
  it("builds hybrid narrative: story + timeline + value layers", async () => {
    const n = await buildNarrative(db, pairId);
    expect(n.agent_story.length).toBeGreaterThan(10);
    expect(n.timeline.length).toBeGreaterThan(0);
    expect(n.value_layers.outcome).toBeGreaterThan(0);
    expect(n.value_layers.trust).toBeGreaterThan(0);
    expect(n.value_layers.choice).toBeGreaterThan(0);
    expect(n.steering_hooks).toEqual(["keep", "discard", "steer"]);
  });

  it("steering hooks feed back across the boundary into pair memory", async () => {
    await receiveSteering(db, pairId, { action: "steer", note: "focus more on retrieval quality" });
    const n = await buildNarrative(db, pairId);
    expect(n.value_layers.control).toBeGreaterThan(0);
    const mem = await db.query(
      `select 1 from memory_entries where pair_id = $1 and content like '[steering:%'`,
      [pairId]
    );
    expect(mem.rows.length).toBeGreaterThan(0);
  });
});

// ── Identity model details (§ 8) ────────────────────────────────────────────

describe("pair identity model", () => {
  it("instance uniqueness enforced within a type (§ 8.1)", async () => {
    await expect(
      registerPair(db, { pair_type: "claudi_base", instance_name: "Mason's Claudi" } as any)
    ).rejects.toThrow(/already exists/);
  });

  it("anonymous actors cannot store (§ 9 identity floor)", async () => {
    await expect(store(db, { kind: "anonymous" }, fullPost("anon", "content"))).rejects.toThrow();
  });
});
