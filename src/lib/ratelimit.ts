import { env } from "./env";
import { HttpError } from "./auth";

/**
 * § 15 #10 — public API rate for non-member callers: 30 req/min, burst 60.
 * Token bucket, in-memory per server instance. Good enough for v1.0's
 * single-region deploy; revisit with a shared store when traffic warrants
 * (§ 14 scale & optimization).
 */
const buckets = new Map<string, { tokens: number; updatedAt: number }>();

export function enforcePublicRate(clientKey: string): void {
  const now = Date.now();
  const refillPerMs = env.rate.perMin / 60_000;
  const bucket = buckets.get(clientKey) ?? { tokens: env.rate.burst, updatedAt: now };
  bucket.tokens = Math.min(env.rate.burst, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
  bucket.updatedAt = now;
  if (bucket.tokens < 1) {
    buckets.set(clientKey, bucket);
    throw new HttpError(429, "Public API rate exceeded (30 req/min, burst 60). Register your pair for unrestricted access.");
  }
  bucket.tokens -= 1;
  buckets.set(clientKey, bucket);
  if (buckets.size > 10_000) {
    // drop oldest entries to bound memory
    const cutoff = now - 10 * 60_000;
    for (const [k, b] of buckets) if (b.updatedAt < cutoff) buckets.delete(k);
  }
}
