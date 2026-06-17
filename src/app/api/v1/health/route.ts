import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * Health + DB connectivity. On failure, surfaces the driver error code +
 * a short message (never the connection string) so deploy issues are
 * diagnosable from the response. Includes a redacted shape of DATABASE_URL
 * (host:port/db only) to catch direct-vs-pooler mistakes.
 */
export async function GET() {
  const url = process.env.DATABASE_URL ?? "";
  let dbTarget: string | null = null;
  try {
    const u = new URL(url);
    // username is safe to surface (the project ref is already public in
    // NEXT_PUBLIC_SUPABASE_URL); password is never included.
    dbTarget = `${u.username}@${u.hostname}:${u.port || "(default)"}${u.pathname}`;
  } catch {
    dbTarget = url ? "(unparseable)" : "(unset)";
  }

  try {
    const db = getDb();
    const r = await db.query<{ ok: number }>(`select 1 as ok`);
    return NextResponse.json({
      ok: r.rows[0]?.ok === 1,
      service: "pairgora",
      version: "1.0.0-day6",
      db_target: dbTarget,
    });
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    return NextResponse.json(
      {
        ok: false,
        db_error: { code: err?.code ?? null, message: String(err?.message ?? e).slice(0, 200) },
        db_target: dbTarget,
      },
      { status: 503 }
    );
  }
}
