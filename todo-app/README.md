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
npm run db:link                         # reads SUPABASE_PROJECT_REF from .env

# every time you change a migration:
npm run db:push
```

That's it — the `todos` table and RLS policies are now in your project. No
dashboard clicks. Re-running `db:push` is safe; it only applies pending
migrations.

### `.env` values

| Variable                | Where to find it                                                 |
| ----------------------- | ---------------------------------------------------------------- |
| `SUPABASE_PROJECT_REF`  | Project Settings → General → Reference ID                         |
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

## 5. (Optional) Auto-apply migrations from GitHub

A workflow lives at `.github/workflows/db-migrate.yml` (repo root, not this
folder). It triggers on every push to `main` that touches
`todo-app/supabase/migrations/**` and runs `supabase db push`.

Add three repo secrets in **Settings → Secrets and variables → Actions**:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_ID` (the same Reference ID)
- `SUPABASE_DB_PASSWORD`

After that, you never run `db:push` by hand — just commit a new migration file.

## Adding a new migration

```bash
npm run db:new -- add_due_date          # creates supabase/migrations/<ts>_add_due_date.sql
# edit that file, then:
npm run db:push                         # or just push to main and let CI do it
```

## File map

```
todo-app/
├── index.html, style.css, app.js, config.js   frontend
├── package.json                               db scripts
├── .env.example                               which secrets you need
├── .gitignore
└── supabase/
    ├── config.toml                            local CLI config
    └── migrations/
        └── 20260510000001_init_todos.sql      schema (single source of truth)
```
