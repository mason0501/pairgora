// Local dev database: PGlite + pgvector served over the Postgres wire
// protocol — lets `next dev` run with zero external services (no Docker,
// no cloud). Production uses Supabase Postgres; this is the same SQL.
//
//   node scripts/dev-local-db.mjs        # starts on port 5544
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5544/postgres npm run dev
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const PORT = Number(process.env.PGLITE_PORT ?? 5544);

const db = await PGlite.create({ extensions: { vector } });

const dir = join(import.meta.dirname, "..", "supabase", "migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) {
  console.log(`apply ${f}`);
  await db.exec(await readFile(join(dir, f), "utf8"));
}

const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
await server.start();
console.log(`PGlite (with pgvector) listening on postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`);
console.log("note: single connection at a time — set pool max 1 if needed");
