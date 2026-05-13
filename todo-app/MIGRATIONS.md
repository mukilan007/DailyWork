# Migration playbook

Schema evolution rules for the Tasks app. Follow these and weekly deploys
won't lose data.

## Cardinal rule

> **Migrations are append-only.** Never edit a file in
> `supabase/migrations/` after it has been merged to `main`. Always add a new
> migration. Editing an applied migration silently drifts the database from
> the migration history.

## Local workflow

```bash
npm run db:new -- add_due_date   # creates supabase/migrations/<ts>_add_due_date.sql
# edit the file, then:
npm run db:lint                   # blocks unguarded destructive ops
npm run db:plan                   # diff vs the linked DB
npm run db:push                   # apply (lint runs automatically first)
```

## Writing safe migrations

1. **Idempotent DDL** — use `create table if not exists`, `add column if not
   exists`, `drop policy if exists` + `create policy ...`. A re-run on the
   same DB must be a no-op.
2. **Never combine create-and-destroy** in a single migration. Splitting them
   across two deploys gives you a working rollback window.
3. **Prefer `add column` over `alter column type`.** Type changes can rewrite
   the table and may fail mid-cast. To change a type: add new column,
   backfill, swap reads, drop old (three migrations, three deploys).
4. **Never put long backfills in a migration.** Migrations should be quick
   (seconds) so app downtime is minimal. Run backfills as a separate one-off
   script or batched job.
5. **Always preserve RLS.** Every new table needs `enable row level security`
   plus per-action policies, in the same migration.

## Expand-contract pattern (for breaking changes)

Renaming a column without breaking running clients takes **three deploys**,
not one. Example: rename `is_done` → `completed`.

| Step | Migration | App code |
| ---- | --------- | -------- |
| 1. **Expand** | Add `completed boolean default false`. Trigger or app dual-writes both columns. | Reads still use `is_done`. Writes update both. |
| 2. **Backfill + switch reads** | `update todos set completed = is_done where completed is distinct from is_done;` (offline batch, not in a migration) | Reads use `completed`. Writes still update both. |
| 3. **Contract** | `alter table todos drop column is_done;` with `-- pragma: allow-drop-column reason="..."` | Stops writing `is_done`. |

This is more work than just renaming, but each step is independently
revertable and never breaks live traffic.

## The lint pragmas

If a destructive op is genuinely intentional, opt in at the top of the
migration with one comment line. The lint script reads these.

```sql
-- pragma: allow-drop-column reason="superseded by `is_archived`, deprecated 2026-04-01"
```

| Pragma                     | Allows                          |
| -------------------------- | ------------------------------- |
| `allow-drop-table`         | `DROP TABLE`                    |
| `allow-drop-column`        | `DROP COLUMN`                   |
| `allow-drop-schema`        | `DROP SCHEMA`                   |
| `allow-truncate`           | `TRUNCATE`                      |
| `allow-alter-type`         | `ALTER COLUMN ... TYPE`         |
| `allow-set-not-null`       | `SET NOT NULL`                  |
| `allow-rename`             | `RENAME` table/column           |
| `allow-delete-no-where`    | `DELETE` without `WHERE`        |
| `allow-update-no-where`    | `UPDATE` without `WHERE`        |
| `allow-destructive`        | All of the above (use sparingly) |

The `reason="..."` is **required** — the lint script rejects pragmas that
downgrade an error without one.

> The list above mirrors `RULES` and `STMT_RULES` in
> `../tools/db/migration-lint.mjs` (shared across apps). If you add a new
> rule, update both this table and `daily-rhythm/MIGRATIONS.md`.

## What CI does on every push to `main`

1. **Lint** — `npm run db:lint`. Aborts on any unguarded destructive op.
2. **Backup** — `supabase db dump` of schema + data, uploaded as a 30-day
   artifact named `db-backup-<sha>`. Done **before** any change is applied.
3. **Plan** — `supabase db diff --linked --schema public` posted to the job
   summary so you see the exact DDL that will run.
4. **Apply** — `supabase db push`. Wrapped in a transaction by Supabase CLI,
   so DDL failures roll back automatically.
5. **Verify** — runs `supabase/tests/invariants.sql` against the live DB:
   - Every public table has RLS on.
   - Every expected table exists.
   - Every RLS-enabled table has at least one policy.

If any step fails, the workflow stops. **The applied migration is not
auto-reverted** (Postgres doesn't support that for DDL across multiple
statements) — see "rollback" below.

## Rollback (emergency)

If a deploy lands and breaks production:

1. Go to **Actions → DB migrations → the failing run → Artifacts**.
   Download `db-backup-<sha>` (kept 30 days).
2. The artifact contains `*-schema.sql` and `*-data.sql` — the state of the
   DB just **before** the bad migration ran.
3. Inspect the bad migration and write a **new** "undo" migration that
   reverses its effects. Examples:
   - It added a column → new migration drops it.
   - It changed a default → new migration restores the old default.
   - It dropped a column with data → restore from `*-data.sql` for that
     table, then re-create the column. **This only works if the column was
     dropped within the last 30 days.**
4. Push the undo migration to `main`. CI runs lint + backup + diff + apply +
   verify on it like any other migration.
5. Don't manually edit `supabase_migrations.schema_migrations` unless you
   also revert the SQL by hand. Migration history must match the DB state.

## One-time setup checklist

- [ ] **GitHub repo secrets** (Settings → Secrets and variables → Actions):
  - [ ] `SUPABASE_ACCESS_TOKEN` — https://supabase.com/dashboard/account/tokens
  - [ ] `SUPABASE_PROJECT_ID` — the project ref
  - [ ] `SUPABASE_DB_PASSWORD` — the DB password
- [ ] **Local `.env`** (gitignored): copy from `.env.example`.
- [ ] **Branch protection on `main`**: require the `validate` job to pass
      before merging. This stops unguarded destructive migrations from
      landing in the first place.

## When this isn't enough

This setup gets you reliable, weekly, low-risk deploys on Supabase free tier.
If the project grows:

- **PITR (Point-In-Time-Recovery)**: Supabase Pro ($25/mo) gives 7-day PITR.
  Combine with the artifact backups for two layers.
- **Staging project**: spin up a second Supabase project, set
  `SUPABASE_PROJECT_ID_STAGING` secret, run the apply pipeline against
  staging first on every PR. Catches issues before prod.
- **`supabase test db`**: Supabase has a `pgTAP`-based test runner for
  policy and function tests. Add when you have business logic in the DB.
