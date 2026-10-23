-- Fifth entry type: other (2026-10-23).
--
-- Separate from 20261023000001 rather than an edit to it: that file may or may
-- not have been applied by now, and widening an already-applied constraint has
-- to happen in its own step. Both migrations are drop-and-recreate on the same
-- constraint, so applying them in order leaves the full set either way.
--
-- Additive: widens an allowed value set. No row changes value, nothing is
-- rewritten, and re-running is a no-op.

alter table public.work_log
  drop constraint if exists work_log_entry_type_chk;
alter table public.work_log
  add constraint work_log_entry_type_chk
  check (entry_type in ('task', 'customer_issue', 'bugtracker', 'release', 'other'));

alter table public.todos
  drop constraint if exists todos_entry_type_chk;
alter table public.todos
  add constraint todos_entry_type_chk
  check (entry_type in ('task', 'customer_issue', 'bugtracker', 'release', 'other'));
