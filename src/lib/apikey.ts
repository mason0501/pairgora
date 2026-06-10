import { createHash, randomBytes } from "crypto";

/**
 * API keys (§ 10.1 step 3 "manual API key" path).
 * Plaintext is shown exactly once at issuance; only the hash is stored
 * (CLAUDE.md boundary: no secrets at rest).
 */
export function issueApiKey(prefix: "pair" | "agent"): { key: string; hash: string } {
  const key = `chk_${prefix}_${randomBytes(24).toString("base64url")}`;
  return { key, hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
