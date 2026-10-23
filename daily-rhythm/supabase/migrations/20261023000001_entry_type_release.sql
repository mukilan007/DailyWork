-- Fourth entry type: release (2026-10-23).
--
-- A new migration rather than an edit to 20261022000003: that one has already
-- been applied (its columns exist in the live schema), so its constraints have
-- to be dropped and re-added here instead.
--
-- Additive: widens an allowed value set. No row changes value, nothing is
-- rewritten, and re-running is a no-op.

alter table public.work_log
  drop constraint if exists work_log_entry_type_chk;
alter table public.work_log
  add constraint work_log_entry_type_chk
  check (entry_type in ('task', 'customer_issue', 'bugtracker', 'release'));

alter table public.todos
  drop constraint if exists todos_entry_type_chk;
alter table public.todos
  add constraint todos_entry_type_chk
  check (entry_type in ('task', 'customer_issue', 'bugtracker', 'release'));
