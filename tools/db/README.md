# Shared DB migration tooling

Common scripts used by every app in this repo (`todo-app/`, `daily-rhythm/`, and any future ones).

## Files

| File | Purpose |
|------|---------|
| `migration-lint.mjs` | Scans `supabase/migrations/*.sql` for destructive ops (DROP, TRUNCATE, RENAME, etc.). Pragma-based opt-in for intentional cases. |
| `db-link.mjs` | Reads `.env`, runs `supabase link --project-ref <id>`. Cross-platform replacement for inline `%VAR%`/`$VAR` shell expansion. |

Both scripts run **with the app directory as CWD** — they read/write paths relative to wherever you `cd`'d to. That's how each app's own `supabase/migrations/` folder gets scanned.

## Adding a new app to this pipeline

1. Create the app dir with `supabase/migrations/` and `supabase/tests/invariants.sql` (per-app expected tables list).

2. Add db scripts to the new app's `package.json`:

   ```json
   {
     "scripts": {
       "db:link":  "node ../tools/db/db-link.mjs",
       "db:lint":  "node ../tools/db/migration-lint.mjs",
       "db:new":   "supabase migration new",
       "db:plan":  "supabase db diff --linked --schema public",
       "db:push":  "npm run db:lint && supabase db push",
       "db:reset": "supabase db reset --linked",
       "db:dump":  "supabase db dump --linked -f backup-schema.sql"
     },
     "devDependencies": { "supabase": "^2.98.2" }
   }
   ```

3. Create a CI workflow at `.github/workflows/db-migrate-<app>.yml` that calls the reusable workflow:

   ```yaml
   name: DB migrations (<app>)
   on:
     pull_request:
       paths: ["<app>/supabase/migrations/**", "tools/db/**"]
     push:
       branches: [master, main]
       paths: ["<app>/supabase/migrations/**", "tools/db/**"]
     workflow_dispatch:
   jobs:
     migrate:
       uses: ./.github/workflows/_db-migrate.yml
       with:
         app_dir: <app>
       secrets: inherit
   ```

4. Make sure repo secrets are set (one-time, shared across all apps): `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`.

That's it. Pushing migrations to the default branch auto-applies via the same lint → backup → diff → push → verify pipeline that the existing apps use.

## Why per-app `invariants.sql` instead of shared

Each app's expected-tables list differs (`todo-app` expects `todos`, `daily-rhythm` expects 7 different tables). Keeping them per-app is clearer than parameterizing one shared SQL file with an env var. The *checks* are identical — only the table list changes.

## Lint pragmas

To allow a destructive op intentionally, add a comment at the top of the migration file:

```sql
-- pragma: allow-drop-column reason="superseded by is_archived (2026-04-01)"
```

The `reason="..."` clause is required. See each app's `MIGRATIONS.md` for the full pragma table.
