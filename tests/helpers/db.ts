import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db, Sql } from "@/lib/db";

/**
 * Test database: PGlite (real Postgres compiled to WASM) + pgvector.
 * Runs the actual production migrations — schema invariants are tested
 * against the same SQL that ships.
 */
export async function makeTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const lite = await PGlite.create({ extensions: { vector } });

  const dir = join(__dirname, "..", "..", "supabase", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await lite.exec(await readFile(join(dir, f), "utf8"));
  }

  const asSql = (q: typeof lite.query): Sql => ({
    query: async (text, params) => {
      const r = await q.call(lite, text, params as any[]);
      return { rows: r.rows as any[] };
    },
  });

  const db: Db = {
    ...asSql(lite.query),
    async tx(fn) {
      return lite.transaction(async (t) => {
        return fn({
          query: async (text, params) => {
            const r = await t.query(text, params as any[]);
            return { rows: r.rows as any[] };
          },
        });
      }) as any;
    },
  };

  return { db, close: () => lite.close() };
}
