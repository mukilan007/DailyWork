# Daily Rhythm — DB migrations playbook

Same pipeline as todo-app: append-only migrations, lint guards against data loss, CI applies on push to default branch with pre-deploy backups + post-deploy invariants.

## Cardinal rule: append-only

Never edit a migration that has been applied to any environment. Always write a NEW migration. The migration filename timestamp dictates apply order.

## Local workflow

```bash
cd daily-rhythm

# One-time setup
cp .env.example .env
# fill in SUPABASE_PROJECT_ID, SUPABASE_DB_PASSWORD, SUPABASE_ACCESS_TOKEN
npx supabase login   # paste the access token
npm run db:link      # links your local CLI to the remote project

# Create a new migration
npm run db:new -- add_user_settings
# edit the generated file in supabase/migrations/

# Validate before push
npm run db:lint

# Preview the diff vs the live DB
npm run db:plan

# Apply (lint runs first; rejects unguarded destructive ops)
npm run db:push
```

## Idempotent DDL

Always write migrations that can be re-run safely:

```sql
create table if not exists ...
create index if not exists ...
alter table ... add column if not exists ...
drop policy if exists ... on ...;
create policy ...
```

The CI runs `supabase db push` which only applies *new* files, but idempotent statements protect against partial-apply scenarios.

## Expand-contract for breaking changes

Renaming a column, splitting a table, removing fields — **never do it in one deploy**. Three deploys:

1. **Expand** — add the new shape alongside the old. Both are populated by the app.
2. **Migrate** — backfill data; flip the app to read+write the new shape.
3. **Contract** — remove the old shape (after at least one full release cycle of (2) being live).

This way no client running the previous version of the app ever talks to a schema it doesn't understand.

## Lint pragmas

The lint script blocks dangerous SQL by default. To opt in, add a comment to the migration file:

```sql
-- pragma: allow-drop-column reason="superseded by is_archived (2026-04-01)"
```

| Pragma | Allows |
|--------|--------|
| `allow-drop-table`   | `DROP TABLE` |
| `allow-drop-column`  | `DROP COLUMN` |
| `allow-drop-schema`  | `DROP SCHEMA` |
| `allow-truncate`     | `TRUNCATE` |
| `allow-alter-type`   | `ALTER ... TYPE` |
| `allow-set-not-null` | `SET NOT NULL` |
| `allow-rename`       | `RENAME` (table/column/view) |
| `allow-delete-no-where` | `DELETE` without `WHERE` |
| `allow-update-no-where` | `UPDATE` without `WHERE` |
| `allow-destructive`  | All of the above (blanket) |

`reason="..."` is **required** — the lint rejects pragmas without one.

The lint script lives at `../tools/db/migration-lint.mjs` (shared across
apps). If you add a new rule there, also update this table and
`todo-app/MIGRATIONS.md`.

## What CI does

On push to `master` (or `main`):

1. **Validate** — runs `migration-lint.mjs`. Any blocking issue fails the run.
2. **Backup** — dumps schema + data to artifacts (30-day retention).
3. **Plan** — runs `db diff` and posts the SQL it would generate to the job summary.
4. **Apply** — runs `supabase db push`.
5. **Verify** — runs `supabase/tests/invariants.sql` against the live DB. Any failed invariant fails the run.

## Rollback procedure

Migrations don't auto-rollback (Postgres has no transactional DDL for many statements). To undo:

1. **Identify the bad migration** from the failed CI run's "Plan" output.
2. **Restore from the backup artifact** (download from the failed run's Actions page) — `psql -f backup-schema.sql` on a fresh DB, then `psql -f backup-data.sql`. For Supabase production, use the dashboard's PITR (Point In Time Recovery) feature instead of restoring manually.
3. **Write a forward migration** that fixes whatever the bad one did. Don't delete the bad migration file (history is append-only).

For unreleased migrations only: `supabase db reset --linked` will rebuild the DB from scratch using all migrations + seed. **Never run this on production data.**

## One-time CI setup

Repo → **Settings → Secrets and variables → Actions** → add:

- `SUPABASE_ACCESS_TOKEN` — https://supabase.com/dashboard/account/tokens
- `SUPABASE_PROJECT_ID` — e.g. `qpjrzzutqkicqsqimanq`
- `SUPABASE_DB_PASSWORD` — the password from your project settings

These are the same secrets the todo-app workflow uses; if they're already set, the daily-rhythm workflow picks them up automatically.
