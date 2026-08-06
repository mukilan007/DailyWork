-- Broaden on-demand pruning to ALL time-stamped history (2026-08-03).
--
-- Per the owner's choice, `prune_my_data()` now prunes every table that holds
-- dated history older than the caller's retention window — not just the
-- original five. Each delete is still scoped to auth.uid().
--
-- IN SCOPE (deleted when older than the window, by the noted column):
--   activity_completions.completed_on, workouts.performed_at (+exercises cascade),
--   period_logs.log_date, glucose_readings.measured_at, todos.created_at,
--   mood_logs.log_date, study_sessions.studied_on, focus_sessions.started_at,
--   planner_blocks.block_date, coding_problems.created_at, learn_phases.created_at,
--   mock_interviews.taken_on, job_applications.updated_at, vault_notes.updated_at,
--   finance_transactions.occurred_on, finance_budgets.month
--
-- NEVER pruned (configuration / current setup — not time-series; deleting them
-- would break the app or lose your setup):
--   profiles, activities, finance_accounts, finance_categories,
--   finance_recurrences, todo_recurrences, user_integrations, user_settings
--
-- Idempotent: safe to re-run. Nothing is deleted until a user calls it, and
-- only rows older than their retention window.

create or replace function public.prune_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  months smallint;
  cd date;         -- cutoff date
  ct timestamptz;  -- cutoff timestamp
  n int;
  total int := 0;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  months := coalesce(
    (select retention_months from public.profiles where user_id = uid),
    24
  );
  cd := current_date - (months || ' months')::interval;
  ct := now() - (months || ' months')::interval;

  delete from public.activity_completions where user_id = uid and completed_on < cd;
  get diagnostics n = row_count; total := total + n;

  delete from public.workouts where user_id = uid and performed_at < ct;
  get diagnostics n = row_count; total := total + n;  -- workout_exercises cascade

  delete from public.period_logs where user_id = uid and log_date < cd;
  get diagnostics n = row_count; total := total + n;

  delete from public.glucose_readings where user_id = uid and measured_at < ct;
  get diagnostics n = row_count; total := total + n;

  delete from public.todos where user_id = uid and created_at < ct;
  get diagnostics n = row_count; total := total + n;

  delete from public.mood_logs where user_id = uid and log_date < cd;
  get diagnostics n = row_count; total := total + n;

  delete from public.study_sessions where user_id = uid and studied_on < cd;
  get diagnostics n = row_count; total := total + n;

  delete from public.focus_sessions where user_id = uid and started_at < ct;
  get diagnostics n = row_count; total := total + n;

  delete from public.planner_blocks where user_id = uid and block_date < cd;
  get diagnostics n = row_count; total := total + n;

  delete from public.coding_problems where user_id = uid and created_at < ct;
  get diagnostics n = row_count; total := total + n;

  delete from public.learn_phases where user_id = uid and created_at < ct;
  get diagnostics n = row_count; total := total + n;

  delete from public.mock_interviews where user_id = uid and taken_on < cd;
  get diagnostics n = row_count; total := total + n;

  delete from public.job_applications where user_id = uid and updated_at < ct;
  get diagnostics n = row_count; total := total + n;

  delete from public.vault_notes where user_id = uid and updated_at < ct;
  get diagnostics n = row_count; total := total + n;

  delete from public.finance_transactions where user_id = uid and occurred_on < cd;
  get diagnostics n = row_count; total := total + n;

  delete from public.finance_budgets where user_id = uid and month < cd;
  get diagnostics n = row_count; total := total + n;

  return jsonb_build_object('retention_months', months, 'total', total);
end;
$$;

revoke all on function public.prune_my_data() from public;
revoke all on function public.prune_my_data() from anon;
grant execute on function public.prune_my_data() to authenticated;

comment on function public.prune_my_data() is
  'Prunes ALL of the calling user''s dated history older than retention_months (config tables excluded); returns the total rows deleted.';
