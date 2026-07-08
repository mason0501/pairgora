import { NextRequest, NextResponse } from "next/server";
import { checkAdminToken, adminCookieValue, ADMIN_COOKIE } from "@/lib/admin";

/** § 25.1 — exchange the admin access token for an httpOnly session cookie (24h). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as { token?: string });
  if (!checkAdminToken((body as { token?: string }).token ?? "")) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, adminCookieValue(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return res;
}
