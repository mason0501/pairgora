import { createHash } from "crypto";

/** Canonical JSON (sorted keys) so semantically equal envelopes hash equal. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

/** § 7.1 pair_context_fingerprint — for pair-context-as-query matching. */
export function contextFingerprint(envelope: unknown): string {
  return createHash("sha256").update(canonical(envelope ?? {})).digest("hex").slice(0, 32);
}
