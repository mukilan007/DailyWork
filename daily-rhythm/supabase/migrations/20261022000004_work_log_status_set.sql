-- Wider work-log status set (2026-10-22).
--
-- Replaces done/in_progress/blocked with a ten-state workflow. Existing rows
-- are remapped BEFORE the constraint is swapped, so nothing is ever left
-- violating a check and no row is deleted:
--
--   done     -> completed   (same meaning, new name)
--   blocked  -> on_hold     (nearest state in the new set)
--   in_progress            (unchanged; still valid)
--
-- Additive in effect and idempotent: the remap only matches the two old
-- values, so re-running is a no-op once applied.

-- 1. Drop the old check first; otherwise the remap below would violate it.
alter table public.work_log
  drop constraint if exists work_log_status_check;

-- 2. Carry existing rows onto the new vocabulary.
update public.work_log set status = 'completed' where status = 'done';
update public.work_log set status = 'on_hold'   where status = 'blocked';

-- 3. New default. The old one ('done') no longer exists as a value.
alter table public.work_log
  alter column status set default 'completed';

-- 4. Re-apply the check over the new set.
alter table public.work_log
  add constraint work_log_status_check
  check (status in (
    'open',
    'in_progress',
    'fixed_in_developer',
    'fixed',
    'not_an_issue',
    'later',
    'not_reproduced',
    'completed',
    'closed',
    'on_hold'
  ));
