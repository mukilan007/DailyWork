-- Job-switch prep + day planner feature set (2026-08-03).
--
-- Purely ADDITIVE — the app is live; nothing here touches existing rows.
-- Every table gets:
--   * RLS locked to auth.uid() = user_id (matches every other table)
--   * ON DELETE CASCADE from auth.users (account deletion stays complete)
--   * a unique index on its natural key where one exists, so accidental
--     duplicates (double-submits, concurrent tabs, re-imports) are rejected
--     at the DB — storage is limited and duplicates are never wanted.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Coding tracker — promoted from localStorage to Supabase.
--    Natural key: a problem URL is unique per user. The one-time localStorage
--    import upserts against this, so re-imports can't duplicate.
-- ---------------------------------------------------------------------------
create table if not exists public.coding_problems (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  url         text not null check (length(url) <= 2000),
  title       text not null check (length(title) <= 300),
  platform    text not null default '',
  difficulty  text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  status      text not null default 'todo' check (status in ('todo', 'in_progress', 'solved')),
  tags        text[] not null default '{}',
  -- Target-company tags ("amazon", "google") — separate from topic tags so
  -- "solve Amazon-tagged mediums" filters don't collide with "arrays".
  companies   text[] not null default '{}',
  solved_on   date,
  -- Spaced repetition: when the problem was last revised (null = never).
  last_revised_on date,
  revise_count    int not null default 0 check (revise_count >= 0),
  notes       text,
  created_at  timestamptz not null default now()
);

create unique index if not exists coding_problems_user_url_uidx
  on public.coding_problems (user_id, url);
create index if not exists coding_problems_user_solved_idx
  on public.coding_problems (user_id, solved_on);

alter table public.coding_problems enable row level security;
drop policy if exists "coding_problems_own" on public.coding_problems;
create policy "coding_problems_own" on public.coding_problems
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Learn phases double as the Interview Prep Roadmap: each row is a topic on
-- a track with an optional target date; progress comes from `stage`.
create table if not exists public.learn_phases (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  topic        text not null check (length(trim(topic)) > 0 and length(topic) <= 200),
  stage        text not null default 'learning'
               check (stage in ('learning', 'practicing', 'reviewing', 'mastered')),
  track        text not null default 'dsa'
               check (track in ('dsa', 'system_design', 'behavioral', 'project', 'other')),
  started_on   date not null,
  target_on    date,
  completed_on date,
  notes        text,
  created_at   timestamptz not null default now()
);

create unique index if not exists learn_phases_user_topic_uidx
  on public.learn_phases (user_id, topic);

alter table public.learn_phases enable row level security;
drop policy if exists "learn_phases_own" on public.learn_phases;
create policy "learn_phases_own" on public.learn_phases
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. Recurring todos — mirrors finance_recurrences / finance_transactions.
--    Materialised todos carry (recurrence_id, recurrence_due_on) and the
--    unique index makes materialisation idempotent under concurrent runs.
-- ---------------------------------------------------------------------------
create table if not exists public.todo_recurrences (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  template_json        jsonb not null,
  frequency            text not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  interval_n           int not null default 1 check (interval_n between 1 and 365),
  start_on             date not null,
  end_on               date,
  last_materialised_on date,
  created_at           timestamptz not null default now()
);

alter table public.todo_recurrences enable row level security;
drop policy if exists "todo_recurrences_own" on public.todo_recurrences;
create policy "todo_recurrences_own" on public.todo_recurrences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.todos
  add column if not exists recurrence_id uuid references public.todo_recurrences(id) on delete set null;
alter table public.todos
  add column if not exists recurrence_due_on date;

create unique index if not exists todos_recurrence_occurrence_uidx
  on public.todos (recurrence_id, recurrence_due_on);

-- ---------------------------------------------------------------------------
-- 3. Mood / energy check-ins — at most one per day per slot by design.
-- ---------------------------------------------------------------------------
create table if not exists public.mood_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  log_date   date not null,
  slot       text not null check (slot in ('morning', 'evening')),
  mood       smallint not null check (mood between 1 and 5),
  energy     smallint not null check (energy between 1 and 5),
  note       text,
  created_at timestamptz not null default now()
);

create unique index if not exists mood_logs_user_day_slot_uidx
  on public.mood_logs (user_id, log_date, slot);

alter table public.mood_logs enable row level security;
drop policy if exists "mood_logs_own" on public.mood_logs;
create policy "mood_logs_own" on public.mood_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. Study sessions — hours per topic; weekly targets live in user_settings.
-- ---------------------------------------------------------------------------
create table if not exists public.study_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  studied_on date not null,
  topic      text not null check (length(trim(topic)) > 0 and length(topic) <= 200),
  minutes    int not null check (minutes between 1 and 1440),
  notes      text,
  created_at timestamptz not null default now()
);

create index if not exists study_sessions_user_day_idx
  on public.study_sessions (user_id, studied_on);

alter table public.study_sessions enable row level security;
drop policy if exists "study_sessions_own" on public.study_sessions;
create policy "study_sessions_own" on public.study_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 5. Job application pipeline — Kanban. Natural key: (company, role).
-- ---------------------------------------------------------------------------
create table if not exists public.job_applications (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  company          text not null check (length(trim(company)) > 0 and length(company) <= 200),
  role             text not null check (length(trim(role)) > 0 and length(role) <= 200),
  stage            text not null default 'wishlist'
                   check (stage in ('wishlist', 'applied', 'oa', 'interview', 'offer', 'rejected')),
  jd_url           text,
  referral_contact text,
  salary_note      text,
  follow_up_on     date,
  notes            text,
  position         int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists job_applications_user_company_role_uidx
  on public.job_applications (user_id, company, role);

alter table public.job_applications enable row level security;
drop policy if exists "job_applications_own" on public.job_applications;
create policy "job_applications_own" on public.job_applications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 6. Mock interview log.
-- ---------------------------------------------------------------------------
create table if not exists public.mock_interviews (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  taken_on    date not null,
  source      text not null default '' , -- company or platform (Pramp, peer, …)
  kind        text not null default 'dsa'
              check (kind in ('dsa', 'system_design', 'behavioral', 'full_loop')),
  self_rating smallint not null check (self_rating between 1 and 5),
  questions   text,
  feedback    text,
  created_at  timestamptz not null default now()
);

create index if not exists mock_interviews_user_day_idx
  on public.mock_interviews (user_id, taken_on);

alter table public.mock_interviews enable row level security;
drop policy if exists "mock_interviews_own" on public.mock_interviews;
create policy "mock_interviews_own" on public.mock_interviews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 7. Vault — STAR stories, brag doc entries, resume notes.
-- ---------------------------------------------------------------------------
create table if not exists public.vault_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null default 'general'
             check (kind in ('star_story', 'achievement', 'resume_note', 'general')),
  title      text not null check (length(trim(title)) > 0 and length(title) <= 300),
  body       text not null default '',
  tags       text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists vault_notes_user_kind_title_uidx
  on public.vault_notes (user_id, kind, title);

alter table public.vault_notes enable row level security;
drop policy if exists "vault_notes_own" on public.vault_notes;
create policy "vault_notes_own" on public.vault_notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 8. Focus (pomodoro) sessions — actuals for the estimate-vs-actual loop.
--    Actual minutes per todo are SUMMED from here at read time; no duplicated
--    "actual_min" column on todos (storage frugality + single source of truth).
-- ---------------------------------------------------------------------------
create table if not exists public.focus_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  started_at   timestamptz not null,
  duration_min int not null check (duration_min between 1 and 480),
  todo_id      uuid references public.todos(id) on delete set null,
  topic        text,
  created_at   timestamptz not null default now()
);

create unique index if not exists focus_sessions_user_start_uidx
  on public.focus_sessions (user_id, started_at);
create index if not exists focus_sessions_todo_idx
  on public.focus_sessions (todo_id);

alter table public.focus_sessions enable row level security;
drop policy if exists "focus_sessions_own" on public.focus_sessions;
create policy "focus_sessions_own" on public.focus_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 9. Planner blocks — time-blocking for the Today / weekly-planning views.
-- ---------------------------------------------------------------------------
create table if not exists public.planner_blocks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  block_date   date not null,
  start_min    smallint not null check (start_min between 0 and 1439),
  duration_min smallint not null check (duration_min between 5 and 1440),
  title        text not null check (length(trim(title)) > 0 and length(title) <= 200),
  kind         text not null default 'other'
               check (kind in ('todo', 'habit', 'study', 'gym', 'break', 'other')),
  -- Optional link to the underlying row (todo id, activity id, …).
  ref_id       uuid,
  done         boolean not null default false,
  created_at   timestamptz not null default now()
);

create unique index if not exists planner_blocks_user_slot_uidx
  on public.planner_blocks (user_id, block_date, start_min, title);
create index if not exists planner_blocks_user_day_idx
  on public.planner_blocks (user_id, block_date);

alter table public.planner_blocks enable row level security;
drop policy if exists "planner_blocks_own" on public.planner_blocks;
create policy "planner_blocks_own" on public.planner_blocks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 10. Per-user settings — one row per user (PK = user_id).
-- ---------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  weekly_study_target_min int not null default 600 check (weekly_study_target_min between 0 and 10080),
  daily_solve_target      int not null default 1 check (daily_solve_target between 0 and 50),
  switch_target_on        date,
  -- Streak-freeze dates: days excused from breaking the solve streak.
  freeze_dates            date[] not null default '{}',
  notify_enabled          boolean not null default false,
  updated_at              timestamptz not null default now()
);

alter table public.user_settings enable row level security;
drop policy if exists "user_settings_own" on public.user_settings;
create policy "user_settings_own" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
