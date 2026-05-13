-- Daily Rhythm — full schema for all features.
-- Idempotent: safe to re-run. Each table has RLS locked to auth.uid() = user_id.

-- ============================================================================
-- profiles — extends auth.users with display name
-- ============================================================================
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or length(trim(display_name)) > 0 and length(display_name) <= 80),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_select_own on public.profiles for select using (auth.uid() = user_id);
create policy profiles_insert_own on public.profiles for insert with check (auth.uid() = user_id);
create policy profiles_update_own on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy profiles_delete_own on public.profiles for delete using (auth.uid() = user_id);

-- ============================================================================
-- activities — habit definitions
-- ============================================================================
create table if not exists public.activities (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0 and length(name) <= 80),
  icon       text,
  frequency  text not null default 'daily' check (frequency in ('daily', 'weekly', 'custom')),
  created_at timestamptz not null default now()
);
create index if not exists activities_user_idx on public.activities (user_id, created_at desc);

alter table public.activities enable row level security;

drop policy if exists activities_select_own on public.activities;
drop policy if exists activities_insert_own on public.activities;
drop policy if exists activities_update_own on public.activities;
drop policy if exists activities_delete_own on public.activities;
create policy activities_select_own on public.activities for select using (auth.uid() = user_id);
create policy activities_insert_own on public.activities for insert with check (auth.uid() = user_id);
create policy activities_update_own on public.activities for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy activities_delete_own on public.activities for delete using (auth.uid() = user_id);

-- ============================================================================
-- activity_completions — one row per (activity, day) you completed
-- ============================================================================
create table if not exists public.activity_completions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  activity_id  uuid not null references public.activities(id) on delete cascade,
  completed_on date not null,
  created_at   timestamptz not null default now(),
  unique (activity_id, completed_on)
);
create index if not exists activity_completions_user_date_idx
  on public.activity_completions (user_id, completed_on desc);

alter table public.activity_completions enable row level security;

drop policy if exists activity_completions_select_own on public.activity_completions;
drop policy if exists activity_completions_insert_own on public.activity_completions;
drop policy if exists activity_completions_delete_own on public.activity_completions;
create policy activity_completions_select_own on public.activity_completions for select using (auth.uid() = user_id);
create policy activity_completions_insert_own on public.activity_completions for insert with check (auth.uid() = user_id);
create policy activity_completions_delete_own on public.activity_completions for delete using (auth.uid() = user_id);

-- ============================================================================
-- workouts — gym sessions
-- ============================================================================
create table if not exists public.workouts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0 and length(name) <= 120),
  workout_type  text not null,
  performed_at  timestamptz not null default now(),
  duration_min  integer check (duration_min is null or duration_min between 0 and 1440),
  calories      integer check (calories is null or calories between 0 and 10000),
  rating        smallint check (rating is null or rating between 1 and 5),
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists workouts_user_perf_idx on public.workouts (user_id, performed_at desc);

alter table public.workouts enable row level security;

drop policy if exists workouts_select_own on public.workouts;
drop policy if exists workouts_insert_own on public.workouts;
drop policy if exists workouts_update_own on public.workouts;
drop policy if exists workouts_delete_own on public.workouts;
create policy workouts_select_own on public.workouts for select using (auth.uid() = user_id);
create policy workouts_insert_own on public.workouts for insert with check (auth.uid() = user_id);
create policy workouts_update_own on public.workouts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy workouts_delete_own on public.workouts for delete using (auth.uid() = user_id);

-- ============================================================================
-- workout_exercises — child rows of workouts
-- ============================================================================
create table if not exists public.workout_exercises (
  id         uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0 and length(name) <= 120),
  sets       integer check (sets is null or sets between 0 and 100),
  reps       integer check (reps is null or reps between 0 and 1000),
  weight     numeric(6,2) check (weight is null or weight between 0 and 9999.99),
  position   integer not null default 0
);
create index if not exists workout_exercises_workout_idx on public.workout_exercises (workout_id, position);

alter table public.workout_exercises enable row level security;

drop policy if exists workout_exercises_select_own on public.workout_exercises;
drop policy if exists workout_exercises_insert_own on public.workout_exercises;
drop policy if exists workout_exercises_update_own on public.workout_exercises;
drop policy if exists workout_exercises_delete_own on public.workout_exercises;
create policy workout_exercises_select_own on public.workout_exercises for select using (auth.uid() = user_id);
create policy workout_exercises_insert_own on public.workout_exercises for insert with check (auth.uid() = user_id);
create policy workout_exercises_update_own on public.workout_exercises for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy workout_exercises_delete_own on public.workout_exercises for delete using (auth.uid() = user_id);

-- ============================================================================
-- period_logs — period tracker entries
-- ============================================================================
create table if not exists public.period_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  log_date   date not null,
  is_period  boolean not null default false,
  flow       text check (flow is null or flow in ('light', 'medium', 'heavy')),
  symptoms   text[] not null default '{}',
  mood       text,
  notes      text,
  created_at timestamptz not null default now(),
  unique (user_id, log_date)
);
create index if not exists period_logs_user_date_idx on public.period_logs (user_id, log_date desc);

alter table public.period_logs enable row level security;

drop policy if exists period_logs_select_own on public.period_logs;
drop policy if exists period_logs_insert_own on public.period_logs;
drop policy if exists period_logs_update_own on public.period_logs;
drop policy if exists period_logs_delete_own on public.period_logs;
create policy period_logs_select_own on public.period_logs for select using (auth.uid() = user_id);
create policy period_logs_insert_own on public.period_logs for insert with check (auth.uid() = user_id);
create policy period_logs_update_own on public.period_logs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy period_logs_delete_own on public.period_logs for delete using (auth.uid() = user_id);

-- ============================================================================
-- glucose_readings — diabetes tracking
-- ============================================================================
create table if not exists public.glucose_readings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  measured_at   timestamptz not null default now(),
  value_mg_dl   integer not null check (value_mg_dl between 20 and 700),
  meal_context  text check (meal_context is null or meal_context in ('fasting', 'before_meal', 'after_meal', 'bedtime', 'random')),
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists glucose_readings_user_meas_idx on public.glucose_readings (user_id, measured_at desc);

alter table public.glucose_readings enable row level security;

drop policy if exists glucose_readings_select_own on public.glucose_readings;
drop policy if exists glucose_readings_insert_own on public.glucose_readings;
drop policy if exists glucose_readings_update_own on public.glucose_readings;
drop policy if exists glucose_readings_delete_own on public.glucose_readings;
create policy glucose_readings_select_own on public.glucose_readings for select using (auth.uid() = user_id);
create policy glucose_readings_insert_own on public.glucose_readings for insert with check (auth.uid() = user_id);
create policy glucose_readings_update_own on public.glucose_readings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy glucose_readings_delete_own on public.glucose_readings for delete using (auth.uid() = user_id);
