-- Per-space todo configuration (2026-08-03).
--
-- Each todo space carries its own categories, statuses, and custom fields
-- (stored as JSONB on the space row — storage-lean, no extra tables). Todos
-- gain category/status/tags/custom to use that config. `is_done` stays and is
-- kept in sync by the app (status "done"/"cancelled" => done) so the agenda,
-- dashboard, weekly review, etc. keep working unchanged.
--
-- Additive + idempotent. Existing todos keep all data; a one-time backfill sets
-- status='done' for already-completed todos so the two stay consistent.

-- ---- Per-space config (JSONB arrays of {key,label,color,...}) ----
alter table public.todo_spaces
  add column if not exists categories jsonb not null default '[]'::jsonb;

alter table public.todo_spaces
  add column if not exists custom_fields jsonb not null default '[]'::jsonb;

-- Statuses seed with a sensible default set so every space has working states.
alter table public.todo_spaces
  add column if not exists statuses jsonb not null default
    '[{"key":"todo","label":"Todo","color":"#94a3b8"},
      {"key":"in_progress","label":"In progress","color":"#3b82f6"},
      {"key":"done","label":"Done","color":"#22c55e"},
      {"key":"blocked","label":"Blocked","color":"#ef4444"},
      {"key":"cancelled","label":"Cancelled","color":"#64748b"}]'::jsonb;

-- ---- Todo fields that reference the space config ----
alter table public.todos
  add column if not exists category text;
alter table public.todos
  add column if not exists status text not null default 'todo';
alter table public.todos
  add column if not exists tags text[] not null default '{}'::text[];
alter table public.todos
  add column if not exists custom jsonb not null default '{}'::jsonb;

-- One-time backfill: completed todos should read as status 'done'.
update public.todos set status = 'done'
  where is_done = true and status = 'todo';
