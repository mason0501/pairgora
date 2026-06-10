import { Pool } from "pg";
import { env } from "./env";

/**
 * Minimal SQL interface. Production: pg Pool against Supabase Postgres.
 * Tests: PGlite adapter (tests/helpers/db.ts). Keeping this surface tiny is
 * the R-31 escape hatch in code form — any Postgres works.
 */
export interface Sql {
  query<R = any>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface Db extends Sql {
  /** Run fn inside one transaction — the single-Postgres axis (§ 12.1) lets
   *  card + provenance + embedding + memory share one commit boundary. */
  tx<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
}

export function makePgDb(pool: Pool): Db {
  return {
    query: (text, params) => pool.query(text, params as any[]) as Promise<{ rows: any[] }>,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn({
          query: (text, params) => client.query(text, params as any[]) as Promise<{ rows: any[] }>,
        });
        await client.query("commit");
        return result;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

function isLocal(url: string): boolean {
  return /localhost|127\.0\.0\.1|\[::1\]/.test(url);
}

let _db: Db | null = null;

export function getDb(): Db {
  if (!_db) {
    if (!env.databaseUrl) {
      throw new Error("DATABASE_URL is not set — see .env.example");
    }
    _db = makePgDb(
      new Pool({
        connectionString: env.databaseUrl,
        max: Number(process.env.PGPOOL_MAX ?? 5), // PGlite dev server: set 1
        idleTimeoutMillis: Number(process.env.PGPOOL_MAX) === 1 ? 500 : 30_000,
        ssl: isLocal(env.databaseUrl) ? undefined : { rejectUnauthorized: false },
      })
    );
  }
  return _db;
}

/** pgvector literal — pass as $n::vector */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

/**
 * Postgres array literal — pass as $n::card_type[] / $n::uuid[] etc.
 * (node-pg serializes JS arrays, PGlite does not; a literal works on both.)
 */
export function toArrayLiteral(values: string[]): string {
  return `{${values.map((v) => `"${v.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
}
