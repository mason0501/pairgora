// Applies supabase/migrations/*.sql in order against DATABASE_URL.
// Standard SQL, plain pg — works on Supabase or any Postgres (R-31 trail).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const dir = join(import.meta.dirname, "..", "supabase", "migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
});
await client.connect();

await client.query(`create table if not exists _migrations (
  name text primary key, applied_at timestamptz not null default now())`);

for (const file of files) {
  const done = await client.query(`select 1 from _migrations where name = $1`, [file]);
  if (done.rows.length) {
    console.log(`skip  ${file}`);
    continue;
  }
  const sql = await readFile(join(dir, file), "utf8");
  console.log(`apply ${file}`);
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query(`insert into _migrations (name) values ($1)`, [file]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    console.error(`FAILED ${file}:`, e.message);
    process.exit(1);
  }
}

await client.end();
console.log("migrations complete");
