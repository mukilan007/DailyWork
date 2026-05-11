-- Data retention policy + automatic pruning.
--
-- Per-user retention preference, capped at 24 months (2 years). A nightly
-- pg_cron job (if available) runs `prune_old_data()` which deletes
-- time-series rows older than each user's chosen window.
--
-- PRUNED (time-series):
--   - activity_completions  (by completed_on)
--   - workouts              (by performed_at; cascades to workout_exercises)
--   - period_logs           (by log_date)
--   - glucose_readings      (by measured_at)
--   - todos                 (by created_at)
--
-- NOT pruned (user-related / configuration):
--   - profiles, activities (habit catalog), user_integrations
--
-- Idempotent: safe to re-run.

------------------------------------------------------------
-- 1. Profile column: retention_months (1..24, null = default 24)
------------------------------------------------------------
alter table public.profiles
  add column if not exists retention_months smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_retention_months_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_retention_months_check
      check (retention_months is null or retention_months between 1 and 24);
  end if;
end $$;

comment on column public.profiles.retention_months is
  'How many months of time-series data to keep (1..24). Null = use the default (24 months).';

------------------------------------------------------------
-- 2. Pruning function
------------------------------------------------------------
create or replace function public.prune_old_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  default_months constant smallint := 24;
begin
  -- activity_completions
  delete from public.activity_completions ac
  where ac.completed_on < (
    current_date - (coalesce(
      (select retention_months from public.profiles where user_id = ac.user_id),
      default_months
    ) || ' months')::interval
  );

  -- workouts (workout_exercises cascade via FK)
  delete from public.workouts w
  where w.performed_at < (
    now() - (coalesce(
      (select retention_months from public.profiles where user_id = w.user_id),
      default_months
    ) || ' months')::interval
  );

  -- period_logs
  delete from public.period_logs pl
  where pl.log_date < (
    current_date - (coalesce(
      (select retention_months from public.profiles where user_id = pl.user_id),
      default_months
    ) || ' months')::interval
  );

  -- glucose_readings
  delete from public.glucose_readings g
  where g.measured_at < (
    now() - (coalesce(
      (select retention_months from public.profiles where user_id = g.user_id),
      default_months
    ) || ' months')::interval
  );

  -- todos (all todos older than retention — done or open)
  delete from public.todos t
  where t.created_at < (
    now() - (coalesce(
      (select retention_months from public.profiles where user_id = t.user_id),
      default_months
    ) || ' months')::interval
  );
end;
$$;

-- This function should only run from the scheduler / DB owner. End users
-- never call it directly.
revoke all on function public.prune_old_data() from public;
revoke all on function public.prune_old_data() from anon;
revoke all on function public.prune_old_data() from authenticated;

comment on function public.prune_old_data() is
  'Deletes per-user time-series rows older than each profile''s retention_months (default 24, hard max 24).';

------------------------------------------------------------
-- 3. Schedule daily pruning (03:30 UTC) if pg_cron is enabled.
--    On Supabase, enable from Dashboard → Database → Extensions → pg_cron.
------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'prune-old-data-daily') then
      perform cron.unschedule('prune-old-data-daily');
    end if;
    perform cron.schedule(
      'prune-old-data-daily',
      '30 3 * * *',
      $job$select public.prune_old_data();$job$
    );
  end if;
end $$;
