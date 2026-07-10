import { createHash, randomBytes } from "crypto";

/**
 * Credentials (§ 10.1 credential issuance).
 * Plaintext is shown exactly once at issuance; only the hash is stored
 * (CLAUDE.md boundary: no secrets at rest).
 */
export function issueApiKey(prefix: "pair" | "agent"): { key: string; hash: string } {
  const key = `pgr_${prefix}_${randomBytes(24).toString("base64url")}`;
  return { key, hash: hashApiKey(key) };
}

/**
 * § 26.2 recovery code — issued alongside the api_key at registration, shown
 * once, hash stored. Lets a pair re-issue a lost key without email (email is
 * deferred to the Supabase Auth phase). Recovery-code-only, Mason 7/7.
 */
export function issueRecoveryCode(): { code: string; hash: string } {
  const code = `pgr_rc_${randomBytes(20).toString("base64url")}`;
  return { code, hash: hashApiKey(code) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
