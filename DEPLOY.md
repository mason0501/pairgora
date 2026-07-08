# Pairgora — P4 v2.1 deploy runbook

Branch `p4-v21-impl` (from `1056cca`). Launch gate ①~⑧ + ⑩ + ⑪ + ⑫ complete;
`tsc` · `next build` · `vitest 25/25` green.

## ⚠️ Live-DB gate (do this in order)

The deployed v1.0 app targets the **v1 schema**. Migration `0002` rewrites it to v2.
Applying `0002` to live **before** the v2 app is deployed will break production.
Gate source: handoff "VUCL→Claudi 2026-06-30 P4 freeze" §5 — *Mason sync once, live DB.*

Correct order: **merge/deploy v2 app  →  Mason sync  →  apply `0002` to live  →  seed  →  verify.**

## 1. Environment (Vercel project settings)

| Var | Notes |
|---|---|
| `DATABASE_URL` | Supabase pooled ("transaction") connection string |
| `NEXT_PUBLIC_APP_URL` | `https://pairgora.com` |
| `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` · `SUPABASE_SECRET_KEY` | Supabase keys |
| `ADMIN_ACCESS_TOKEN` | **new** — long random secret; gates `/admin` (§ 25.1) |
| quota / rate vars | optional; see `.env.example` (defaults are fine) |

No `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — Pairgora calls no LLM (invariant 1).

## 2. Ship the v2 app first

- Merge `p4-v21-impl` → deploy branch. Vercel builds (`next build` is green).
- The app now expects v2 schema but live is still v1 → **do not send traffic that
  writes yet**; the next step aligns the DB. (Read paths degrade, not crash.)

## 3. Mason sync → apply migration to live

- **Mason confirms** (the gate). Live has smoke data only, so this is the migration window.
- Apply: `DATABASE_URL=<live> npm run db:migrate`
  - runs `0001` (already applied → skipped) then **`0002`** (the v2 rebuild).
  - `0002` drops embeddings, rebuilds `cards`/`trust_signals`, adds Two-tier pairs,
    bridging, recovery/admin columns. Smoke cards are discarded by design (§ 7.5).
- Migrations are validated in PGlite by the test suite; `0002` is idempotent-safe
  via the `_migrations` ledger (won't re-run).

## 4. Seed the origin pair + launch cards

```
node scripts/seed.mjs https://pairgora.com
```
- Registers the origin pair (Mason & Claudi) → **save the printed API key + recovery code**.
- Stores Reference Card 1 (hydration) + two live origin-pair cards (DNS fix, open question).
- (15번 § 2 Cards 2 & 3 are intentionally skipped — embedding-era, contradict the
  no-embedding story. Claudi to write replacements if desired.)

## 5. Verify

- `/` hero · `/trail` (cards appear in kiosk sections) · `/register` (glyph) ·
  `/docs` · `/manifesto` · `/terms` · `/privacy`.
- `/admin/login` with `ADMIN_ACCESS_TOKEN` → dashboard shows counts, cards, pairs.
- One MCP round-trip with the origin key: `tools/list` → `pairgora_seek`.

## Rollback

- App: redeploy the previous Vercel build (v1.0).
- DB: `0002` is destructive to v1 structures; rollback = restore from Supabase PITR
  / pre-migration `pg_dump`. **Take a `pg_dump` before step 3.**

## Open (post-launch, not blocking)

- ⑨ verified-badge copy tuning · A4/A5/A7 admin (cron) · claim flow (§ 26.3) ·
  Supabase Auth (email) · `/trail` my-pair default · next/font subset ·
  remove unused `openai`/`@anthropic-ai/sdk` deps.
