// One-off rescore (note 24 § 1, Mason 2026-07-29): re-freeze each pair's
// LATEST human_short submission under the short-form θ (profile_theta_short,
// default 0). Raw responses are the durable asset — scoring is deterministic,
// so a θ decision applies retroactively by inserting a NEW result row per
// submission (results are immutable; latest wins, history stays queryable).
//
//   npx tsx scripts/rescore-short.ts          # dry run (prints before/after)
//   npx tsx scripts/rescore-short.ts --apply  # insert the rescored rows
import { Client } from "pg";
import { DEFAULT_THETA_SHORT, scoreProfile } from "../src/lib/profile";

async function main() {
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");
const apply = process.argv.includes("--apply");

const c = new Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
await c.connect();

const theta = await (async () => {
  const r = await c.query(`select value from platform_config where key = 'profile_theta_short'`);
  const v = Number(r.rows[0]?.value);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_THETA_SHORT;
})();

const catalog = (
  await c.query(`select question_id, axis, pole, weight, format from profile_questions where active and form = 'short'`)
).rows;

// latest human_short submission per pair
const subs = (
  await c.query(`
    select distinct on (s.pair_id) s.submission_id, s.pair_id, p.instance_name
      from profile_submissions s join pairs p using (pair_id)
     where s.source = 'human_short'
     order by s.pair_id, s.submitted_at desc`)
).rows;

for (const sub of subs) {
  const responses = (
    await c.query(`select question_id, answer from profile_responses where submission_id = $1`, [sub.submission_id])
  ).rows;
  const result = scoreProfile(catalog, responses, { theta });
  const prev = (
    await c.query(
      `select type_code, theta from profile_results
        where pair_id = $1 and source = 'human_short' order by created_at desc limit 1`,
      [sub.pair_id]
    )
  ).rows[0];
  console.log(
    `${sub.instance_name}: ${prev?.type_code ?? "null"} (θ ${prev?.theta}) → ${result.type_code ?? "null"} (θ ${theta})`,
    result.unresolved_axes.length ? `unresolved: ${result.unresolved_axes.join(",")}` : ""
  );
  if (apply) {
    await c.query(
      `insert into profile_results
         (pair_id, source, submission_id, axes, type_code, unresolved_axes, completeness, theta, approved_at)
       values ($1,'human_short',$2,$3,$4,$5::text[],$6,$7, now())`,
      [
        sub.pair_id,
        sub.submission_id,
        JSON.stringify(result.axes),
        result.type_code,
        `{${result.unresolved_axes.map((a) => `"${a}"`).join(",")}}`,
        result.completeness,
        result.theta,
      ]
    );
  }
}
console.log(apply ? "applied." : "dry run — pass --apply to insert.");
await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
