-- Editable "task date" on todos (2026-08-03).
--
-- The date a ticket is *for* (defaults to today in the app, editable, and
-- independent of the optional due deadline). Nullable; additive; idempotent.

alter table public.todos
  add column if not exists task_date date;

create index if not exists todos_task_date_idx
  on public.todos (space_id, task_date);
