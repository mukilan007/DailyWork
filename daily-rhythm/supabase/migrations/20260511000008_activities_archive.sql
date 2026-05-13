-- Adds a soft-delete flag to activities so users can hide a habit
-- without losing its completion history. Existing RLS / FK behaviour is
-- untouched: hard-deleting an activity still cascades to completions,
-- but the app now prefers archiving and hides archived rows from the list.

alter table public.activities
  add column if not exists is_archived boolean not null default false;

-- Partial index over the common query path: a user's active (unarchived)
-- activities, newest first. Keeps the active list fast even after years
-- of archived rows accumulate.
create index if not exists activities_user_active_idx
  on public.activities (user_id, created_at desc)
  where is_archived = false;
