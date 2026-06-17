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
  // Password SHAPE only — never the value. Distinguishes placeholder /
  // encoding / typo as the cause of 28P01.
  let pwShape: Record<string, unknown> = {};
  try {
    const u = new URL(url);
    dbTarget = `${u.username}@${u.hostname}:${u.port || "(default)"}${u.pathname}`;
    const pw = u.password;
    let decodedLen = -1;
    try {
      decodedLen = decodeURIComponent(pw).length;
    } catch {
      decodedLen = -2; // malformed percent-encoding
    }
    pwShape = {
      len: pw.length,
      decoded_len: decodedLen,
      has_pct: pw.includes("%"),
      looks_placeholder: /[[\]{}]|your[-_]?password/i.test(pw),
      nonalnum: (pw.match(/[^a-zA-Z0-9]/g) ?? []).length,
      empty: pw.length === 0,
    };
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
        pw_shape: pwShape,
      },
      { status: 503 }
    );
  }
}
