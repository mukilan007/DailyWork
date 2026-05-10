# Tasks — a tiny todo web app

Plain HTML + CSS + JS frontend. Supabase (Postgres + Auth) backend. **No
manual SQL pasting** — schema is managed as migration files and applied with
one command (or auto-applied by GitHub Actions).

## 1. Create the Supabase project (one-time, free)

1. Sign up at https://supabase.com → **New project**.
2. Pick a strong DB password (save it — you'll need it below) and the closest region.
3. **Compute size**: NANO ($0/h). **Disk size**: 1 GB. Both stay on the free tier.
4. Wait ~1 min for provisioning.
5. From **Project Settings → API** copy:
   - **Project URL** → paste into `config.js` as `SUPABASE_URL`
   - **anon public** key → paste into `config.js` as `SUPABASE_ANON_KEY`
6. From **Project Settings → General** copy the **Reference ID** (short id like `abcd1234`).

## 2. Apply the schema (one command)

```bash
cd todo-app
npm install                             # installs the Supabase CLI as a dev dep
cp .env.example .env                    # then fill in the values

# one-time login + link
npx supabase login                      # opens browser, paste an access token
npm run db:link                         # reads SUPABASE_PROJECT_ID from .env

# every time you change a migration:
npm run db:push
```

That's it — the `todos` table and RLS policies are now in your project. No
dashboard clicks. Re-running `db:push` is safe; it only applies pending
migrations.

### `.env` values

| Variable                | Where to find it                                                 |
| ----------------------- | ---------------------------------------------------------------- |
| `SUPABASE_PROJECT_ID`   | Project Settings → General → Reference ID (same value as the GitHub Actions secret) |
| `SUPABASE_DB_PASSWORD`  | The DB password you set when creating the project                 |
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens (create a new one)  |

## 3. Run the frontend locally

ES modules need a real HTTP server. Use whichever you prefer:

```bash
npm run dev                # uses `serve` on port 5173
# or:
python -m http.server 5173
```

Open http://localhost:5173 → sign up → add a task.

## 4. Deploy the frontend free

Pick any static host. They all just serve the three files.

- **Cloudflare Pages / Netlify / Vercel** — connect a Git repo, leave build empty, output dir `/` (or `/todo-app`).
- **Surge** — `npx surge .` from `todo-app/`.
- **GitHub Pages** — enable Pages, point at this folder.

Then in Supabase → **Authentication → URL Configuration**, add your deployed
origin to **Site URL** and **Redirect URLs** so confirmation emails come back
to your app.

## 5. Auto-apply migrations from GitHub (recommended for weekly deploys)

A two-stage workflow lives at `.github/workflows/db-migrate.yml`:

| Stage | Runs on | What it does |
| ----- | ------- | ------------ |
| **Validate** | every PR + push | Lints migrations; blocks unguarded destructive ops. |
| **Apply** | push to `main` only | Backup → diff (posted to job summary) → `db push` → invariants check. |

The pre-deploy backup (schema + data) is uploaded as a 30-day GitHub artifact
named `db-backup-<sha>`, so even if a deploy goes wrong you have a snapshot
to restore from.

Add three repo secrets in **Settings → Secrets and variables → Actions**:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_ID` (the same Reference ID — matches the local `.env` name too)
- `SUPABASE_DB_PASSWORD`

After that, you never run `db:push` by hand for prod — just commit a new
migration file. **Read [MIGRATIONS.md](./MIGRATIONS.md) before writing any
migration that drops or renames things.** That doc covers the lint pragmas,
the expand-contract pattern for safe breaking changes, and the rollback
procedure.

## Adding a new migration

```bash
npm run db:new -- add_due_date     # creates supabase/migrations/<ts>_add_due_date.sql
# edit that file
npm run db:lint                     # blocks dangerous ops without an opt-in
npm run db:plan                     # diff vs the linked DB
npm run db:push                     # apply locally — or push to main and let CI do it
```

## File map

```
todo-app/
├── index.html, style.css, app.js, config.js   frontend
├── package.json                               db scripts
├── MIGRATIONS.md                              schema-evolution playbook
├── .env.example                               which secrets you need
├── .gitignore
├── scripts/
│   ├── db-link.mjs                            cross-platform `supabase link`
│   └── migration-lint.mjs                     blocks unguarded destructive ops
└── supabase/
    ├── config.toml                            local CLI config
    ├── migrations/
    │   └── 20260510000001_init_todos.sql      append-only history
    └── tests/
        └── invariants.sql                     post-deploy sanity checks
```
