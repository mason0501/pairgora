import { withApi } from "@/lib/api";

export const GET = withApi(async ({ db }) => {
  const r = await db.query<{ ok: number }>(`select 1 as ok`);
  return { ok: r.rows[0]?.ok === 1, service: "chaldduk", version: "1.0.0-day5" };
});
