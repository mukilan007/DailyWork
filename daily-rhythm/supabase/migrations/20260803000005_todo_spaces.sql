-- Todo spaces (2026-08-03).
--
-- Turns the single todo list into per-space lists (like project workspaces).
-- Each space keeps its own tickets. Todos with a NULL space_id are the default
-- "Inbox" — which is exactly what every existing todo becomes, so nothing moves
-- or is lost. Deleting a space SET NULLs its todos (they fall back to Inbox),
-- so a space delete never destroys tickets.
--
-- Additive + idempotent: safe to re-run, preserves all existing data.

create table if not exists public.todo_spaces (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0 and length(name) <= 100),
  color      text,
  position   int not null default 0,
  created_at timestamptz not null default now()
);

-- One space name per user (case-insensitive) — no duplicate spaces.
create unique index if not exists todo_spaces_user_name_uidx
  on public.todo_spaces (user_id, lower(name));

alter table public.todo_spaces enable row level security;
drop policy if exists "todo_spaces_own" on public.todo_spaces;
create policy "todo_spaces_own" on public.todo_spaces
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Link todos to a space. NULL = Inbox. on delete set null keeps the tickets.
alter table public.todos
  add column if not exists space_id uuid references public.todo_spaces(id) on delete set null;
create index if not exists todos_space_idx on public.todos (space_id);

-- Recurring-todo templates are per-space too, so materialised todos land in the
-- right space.
alter table public.todo_recurrences
  add column if not exists space_id uuid references public.todo_spaces(id) on delete set null;
