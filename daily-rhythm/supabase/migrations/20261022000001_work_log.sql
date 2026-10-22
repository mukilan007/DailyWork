-- Work log (2026-10-22).
--
-- A daily record of what was actually worked on, so a period can be exported
-- as a report to share with a mentor. One row per task per day.
--
-- Purely additive: creates a new table and touches nothing that exists, so no
-- current data is read, rewritten or lost by this migration. Idempotent —
-- safe to re-run.

create table if not exists public.work_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- The day the work happened (not when the row was typed).
  worked_on   date not null,
  title       text not null check (length(trim(title)) > 0 and length(title) <= 200),
  details     text check (length(details) <= 5000),
  -- Workstream / project tag. Free text so it needs no second table; the UI
  -- offers previously-used values as suggestions.
  category    text check (length(category) <= 100),
  status      text not null default 'done'
                check (status in ('done', 'in_progress', 'blocked')),
  -- Effort in minutes. Null = not tracked; 0 is allowed but not meaningful.
  minutes     int check (minutes >= 0 and minutes <= 1440),
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The report and the day list both read by (user, day) in date order.
create index if not exists work_log_user_day_idx
  on public.work_log (user_id, worked_on desc);

-- Powers the category suggestion list without a full scan.
create index if not exists work_log_user_category_idx
  on public.work_log (user_id, category);

alter table public.work_log enable row level security;
drop policy if exists "work_log_own" on public.work_log;
create policy "work_log_own" on public.work_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
