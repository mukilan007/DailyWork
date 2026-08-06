-- Archivable todo spaces (2026-08-03).
--
-- Adds a soft-archive flag to todo_spaces so a space can be hidden from the
-- grid without deleting it or its tickets. Additive + idempotent.

alter table public.todo_spaces
  add column if not exists archived_at timestamptz;

-- Partial index for the common "active spaces only" listing.
create index if not exists todo_spaces_active_idx
  on public.todo_spaces (user_id) where archived_at is null;
