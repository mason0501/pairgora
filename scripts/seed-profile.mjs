// Seeds the Pair Profile question catalog (design notes 21 · 22) into
// profile_questions against DATABASE_URL. Standard SQL, plain pg — same trail
// as migrate.mjs. Idempotent: re-runs update prompt/ordering and re-activate,
// but never touch a question's identity (axis/pole/weight/format) — changing
// what a question measures after responses exist would corrupt longitudinal
// results; that case is a NEW question_id + retiring the old one (active=false).
//
//   node --env-file-if-exists=.env.local scripts/seed-profile.mjs
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const file = join(import.meta.dirname, "..", "supabase", "seed", "profile_questions.json");
const questions = JSON.parse(await readFile(file, "utf8"));

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
});
await client.connect();

let inserted = 0;
let updated = 0;
try {
  await client.query("begin");
  for (const q of questions) {
    const r = await client.query(
      `insert into profile_questions (question_id, axis, pole, weight, format, form, prompt, ordering, active)
       values ($1, $2, $3, $4, $5, $6, $7, $8, true)
       on conflict (question_id) do update
         set prompt = excluded.prompt, ordering = excluded.ordering, active = true
       where profile_questions.axis   = excluded.axis
         and profile_questions.pole   = excluded.pole
         and profile_questions.weight = excluded.weight
         and profile_questions.format = excluded.format
       returning (xmax = 0) as inserted`,
      [q.question_id, q.axis, q.pole, q.weight, q.format, q.form, q.prompt, q.ordering]
    );
    if (!r.rows[0]) {
      throw new Error(
        `${q.question_id}: identity (axis/pole/weight/format) differs from the DB row — ` +
          `retire the old id (active=false) and ship the change as a new question_id`
      );
    }
    r.rows[0].inserted ? inserted++ : updated++;
  }
  await client.query("commit");
} catch (e) {
  await client.query("rollback");
  console.error("FAILED:", e.message);
  process.exit(1);
} finally {
  await client.end();
}

console.log(`profile questions seeded: ${inserted} inserted, ${updated} updated (${questions.length} total)`);
