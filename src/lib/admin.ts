import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { env } from "./env";
import type { Sql } from "./db";

/**
 * § 25.1 admin gate (v1) — single operator. ADMIN_ACCESS_TOKEN env → /admin/login
 * sets an httpOnly cookie holding a hash of the token (raw token never stored in
 * the cookie). Minimal + sufficient until Supabase Auth admin roles (§ 26.2).
 * Every mutation is audited to boundary_events with an `admin:` event type.
 */
export const ADMIN_COOKIE = "pairgora_admin";

function sha(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

export function adminCookieValue(): string {
  return sha(env.adminAccessToken).toString("hex");
}

/** Constant-time compare of a submitted token against the configured one. */
export function checkAdminToken(token: string): boolean {
  if (!env.adminAccessToken || !token) return false;
  return timingSafeEqual(sha(token), sha(env.adminAccessToken));
}

export function verifyAdminCookie(value: string | undefined): boolean {
  if (!env.adminAccessToken || !value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(adminCookieValue());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Server-component / server-action guard. */
export async function isAdmin(): Promise<boolean> {
  const c = await cookies();
  return verifyAdminCookie(c.get(ADMIN_COOKIE)?.value);
}

/** API-route guard. */
export function isAdminReq(req: NextRequest): boolean {
  return verifyAdminCookie(req.cookies.get(ADMIN_COOKIE)?.value);
}

/** § 25.1 audit — who=admin, what, target, before/after → boundary_events. */
export async function adminAudit(db: Sql, action: string, target: string | null, detail: Record<string, unknown> = {}) {
  await db.query(`insert into boundary_events (boundary, event_type, payload) values ('input', $1, $2)`, [
    `admin:${action}`,
    JSON.stringify({ target, ...detail }),
  ]);
}
