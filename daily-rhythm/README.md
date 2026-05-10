# Daily Rhythm

Personal habit, health, and workout tracker. React + Vite + TypeScript + Tailwind, backed by Supabase (auth + Postgres with RLS).

## Phase 1 (current)

✅ Auth (email + password)
✅ Sidebar navigation + dark/light theme
✅ Settings → Profile (display name, password change)
✅ Settings → Appearance (theme switcher)
🚧 Home, Daily Routine, Gym, Health (Period + Diabetes), Integrations — placeholder pages, real features land in Phases 2-4

Database tables for **all** features are created in the Phase 1 migration so future feature work doesn't require schema changes for users who deploy now.

## Setup

### 1. Apply the database migration

**Quick path (one-time)** — Supabase Dashboard → **SQL Editor** → New query → paste the contents of `supabase/migrations/20260510000010_init_daily_rhythm.sql` → Run.

**Automated path (recommended for ongoing work)** — see [MIGRATIONS.md](./MIGRATIONS.md) for the full playbook. Quick start:

```bash
cp .env.example .env
# fill in SUPABASE_PROJECT_ID, SUPABASE_DB_PASSWORD, SUPABASE_ACCESS_TOKEN
npm install
npx supabase login
npm run db:link
npm run db:push
```

Future migrations: `npm run db:new -- name_of_change` → edit the generated file → `npm run db:push`. Pushing to `master` auto-applies them via the GitHub Actions workflow at `.github/workflows/db-migrate-daily-rhythm.yml`.

### 2. Configure local env

```bash
cp .env.example .env
```

Fill in:

```
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
```

`VITE_*` vars are exposed to the browser — only use the publishable/anon key. Never put `service_role` or DB password in `VITE_*`.

### 3. Install + run

```bash
npm install
npm run dev
```

Open http://localhost:5173 → sign up with a fresh email → confirm via the link Supabase emails you → sign in.

### 4. Update Supabase Auth URL Configuration

Dashboard → **Authentication → URL Configuration**:

- **Site URL**: `http://localhost:5173`
- **Redirect URLs**: add `http://localhost:5173/**` (and your production URL once deployed)

## Deploy to Cloudflare Pages

1. Push to GitHub
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** tab → **Connect to Git**
3. Select repo
4. Build settings:
   - **Framework preset**: Vite
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory** (advanced): `daily-rhythm`
5. Add environment variables (Production + Preview):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. Save and Deploy

After first deploy, add the live URL to Supabase Auth → URL Configuration's **Site URL** + **Redirect URLs**.

## Project layout

```
daily-rhythm/
├── src/
│   ├── main.tsx                  app entry
│   ├── App.tsx                   router + providers
│   ├── index.css                 Tailwind base + theme tokens
│   ├── lib/
│   │   ├── supabase.ts           client (browser-safe)
│   │   └── utils.ts              cn() classnames helper
│   ├── hooks/
│   │   ├── useAuth.tsx           AuthProvider + useAuth()
│   │   └── useTheme.tsx          ThemeProvider + useTheme()
│   ├── components/
│   │   ├── ui/                   Button, Input, Card, Label
│   │   └── layout/               Sidebar, AppLayout
│   ├── pages/
│   │   ├── Auth.tsx              sign in / sign up
│   │   ├── SettingsProfile.tsx
│   │   ├── SettingsAppearance.tsx
│   │   └── Placeholder.tsx       Home, DailyRoutine, Gym, Health, Integrations
│   └── types.ts                  Domain types matching Supabase schema
├── supabase/migrations/          DB schema
├── .env.example
├── package.json
├── vite.config.ts
└── tailwind.config.js
```

## Architecture notes

- **Auth bootstrap**: `useAuth` listens to `onAuthStateChange` only (it fires `INITIAL_SESSION` for the persisted session, so a separate `getSession()` would double-load).
- **Theme**: Tailwind's `darkMode: "class"` toggled by `useTheme`. `light | dark | system` (system = follows OS prefers-color-scheme). Persisted in localStorage.
- **RLS**: every table is locked to `auth.uid() = user_id` for select/insert/update/delete. The frontend can never see another user's data even with the publishable key.
- **Per-user `profiles` table**: extends `auth.users` for app-level metadata (display name) without modifying Supabase's auth schema.

## Roadmap

- Phase 2 — Daily Routine + Home dashboard with charts
- Phase 3 — Health → Period tracker + Diabetes
- Phase 4 — Gym Workout (full features) + Integrations UI shell
