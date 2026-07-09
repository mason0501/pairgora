import { NextRequest, NextResponse } from "next/server";
import { checkAdminToken, adminCookieValue, ADMIN_COOKIE } from "@/lib/admin";
import { enforcePublicRate } from "@/lib/ratelimit";

/** § 25.1 — exchange the admin access token for an httpOnly session cookie (24h). */
export async function POST(req: NextRequest) {
  // brute-force guard: login attempts share the public token bucket per IP
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  try {
    enforcePublicRate(`admin-login:${ip}`);
  } catch {
    return NextResponse.json({ error: "too many attempts" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}) as { token?: string });
  if (!checkAdminToken((body as { token?: string }).token ?? "")) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, adminCookieValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // allow plain-http localhost login in dev
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return res;
}
