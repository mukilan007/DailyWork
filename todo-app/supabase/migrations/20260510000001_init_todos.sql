-- Initial schema: todos table with per-user RLS.
-- This file is the single source of truth for the schema.
-- Apply with `npm run db:push` (or via the GitHub Actions workflow).

create table if not exists public.todos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  title       text not null check (length(trim(title)) > 0 and length(title) <= 200),
  is_done     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists todos_user_created_idx
  on public.todos (user_id, created_at desc);

alter table public.todos enable row level security;

drop policy if exists "todos_select_own" on public.todos;
create policy "todos_select_own"
  on public.todos for select
  using (auth.uid() = user_id);

drop policy if exists "todos_insert_own" on public.todos;
create policy "todos_insert_own"
  on public.todos for insert
  with check (auth.uid() = user_id);

drop policy if exists "todos_update_own" on public.todos;
create policy "todos_update_own"
  on public.todos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "todos_delete_own" on public.todos;
create policy "todos_delete_own"
  on public.todos for delete
  using (auth.uid() = user_id);
