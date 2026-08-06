-- On-demand data pruning (2026-08-03).
--
-- pg_cron is not available on this project, so the nightly `prune_old_data()`
-- job never runs. This adds a user-callable `prune_my_data()` that prunes ONLY
-- the calling user's own time-series rows older than their retention window,
-- wired to a "Prune now" button in Settings. Returns per-table delete counts.
--
-- Same tables/policy as prune_old_data(): activity_completions, workouts
-- (+ workout_exercises via cascade), period_logs, glucose_readings, todos.
-- All other tables (prep history, finance, profile, config) are kept.
--
-- Idempotent: safe to re-run.

create or replace function public.prune_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  months smallint;
  cutoff_date date;
  cutoff_ts timestamptz;
  n_ac int; n_w int; n_pl int; n_g int; n_t int;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  months := coalesce(
    (select retention_months from public.profiles where user_id = uid),
    24
  );
  cutoff_date := current_date - (months || ' months')::interval;
  cutoff_ts := now() - (months || ' months')::interval;

  -- Every delete is scoped to `uid` so a user can only prune their own data,
  -- even though the function runs as owner (SECURITY DEFINER bypasses RLS).
  delete from public.activity_completions
    where user_id = uid and completed_on < cutoff_date;
  get diagnostics n_ac = row_count;

  delete from public.workouts
    where user_id = uid and performed_at < cutoff_ts;
  get diagnostics n_w = row_count;

  delete from public.period_logs
    where user_id = uid and log_date < cutoff_date;
  get diagnostics n_pl = row_count;

  delete from public.glucose_readings
    where user_id = uid and measured_at < cutoff_ts;
  get diagnostics n_g = row_count;

  delete from public.todos
    where user_id = uid and created_at < cutoff_ts;
  get diagnostics n_t = row_count;

  return jsonb_build_object(
    'retention_months', months,
    'activity_completions', n_ac,
    'workouts', n_w,
    'period_logs', n_pl,
    'glucose_readings', n_g,
    'todos', n_t,
    'total', n_ac + n_w + n_pl + n_g + n_t
  );
end;
$$;

-- Locked down: only authenticated users may call it, and it only ever touches
-- the caller's own rows.
revoke all on function public.prune_my_data() from public;
revoke all on function public.prune_my_data() from anon;
grant execute on function public.prune_my_data() to authenticated;

comment on function public.prune_my_data() is
  'Prunes the calling user''s time-series rows older than their retention_months; returns per-table delete counts.';
