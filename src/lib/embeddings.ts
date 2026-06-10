import { createHash } from "crypto";
import { env } from "./env";

export const EMBEDDING_DIM = 1536; // § 15 #9 (Mason C decision)

export interface EmbeddingResult {
  embedding: number[];
  model: string;
}

/**
 * Embedding provider — thin abstraction (§ 12.1 "direct SDK, swap 자유").
 * With OPENAI_API_KEY: text-embedding-3-small / 1536-dim.
 * Without: deterministic feature-hashing embedding so dev/test retrieval
 * still ranks by token overlap. The `model` column records which one was
 * used, so prod can backfill local-dev rows later.
 */
export async function embed(text: string): Promise<EmbeddingResult> {
  if (env.openaiKey) {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: env.openaiKey });
    const res = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000),
      dimensions: EMBEDDING_DIM,
    });
    return { embedding: res.data[0].embedding, model: "text-embedding-3-small" };
  }
  return { embedding: localHashEmbedding(text), model: "local-dev-hash" };
}

/** Feature hashing: each token hashed to a dimension with a sign; normalized. */
export function localHashEmbedding(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9가-힣]+/).filter((t) => t.length > 1);
  for (const tok of tokens) {
    const h = createHash("sha256").update(tok).digest();
    const dim = h.readUInt32BE(0) % EMBEDDING_DIM;
    const sign = h[4] % 2 === 0 ? 1 : -1;
    v[dim] += sign;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
