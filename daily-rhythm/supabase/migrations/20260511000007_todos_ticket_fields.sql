-- pragma: allow-set-not-null reason="priority is backfilled to 'medium' before SET NOT NULL (see UPDATE below)"
-- Promote todos to "tickets" with timing + priority metadata.
-- Adds:
--   * description    - optional long-form notes
--   * due_at         - optional timestamp when the ticket is due
--   * priority       - low | medium | high (default 'medium')
--   * estimated_min  - optional estimated effort in minutes (1..1440)
--
-- Idempotent: safe to re-run on databases that already have some of the columns.

alter table public.todos
  add column if not exists description    text,
  add column if not exists due_at         timestamptz,
  add column if not exists priority       text default 'medium',
  add column if not exists estimated_min  integer;

-- Backfill any pre-existing rows that have a NULL priority so the CHECK passes.
update public.todos set priority = 'medium' where priority is null;

alter table public.todos
  alter column priority set not null,
  alter column priority set default 'medium';

-- Constrain priority to a small enum-like set. Drop any prior named CHECK first
-- so this migration is replayable.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'todos_priority_check'
      and conrelid = 'public.todos'::regclass
  ) then
    alter table public.todos drop constraint todos_priority_check;
  end if;
end $$;

alter table public.todos
  add constraint todos_priority_check
  check (priority in ('low', 'medium', 'high'));

-- Estimated effort: positive and capped at a day's worth of minutes.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'todos_estimated_min_check'
      and conrelid = 'public.todos'::regclass
  ) then
    alter table public.todos drop constraint todos_estimated_min_check;
  end if;
end $$;

alter table public.todos
  add constraint todos_estimated_min_check
  check (estimated_min is null or (estimated_min > 0 and estimated_min <= 1440));

-- Description length cap.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'todos_description_length'
      and conrelid = 'public.todos'::regclass
  ) then
    alter table public.todos drop constraint todos_description_length;
  end if;
end $$;

alter table public.todos
  add constraint todos_description_length
  check (description is null or char_length(description) <= 2000);

-- Index helps "what's due next" queries.
create index if not exists todos_user_due_idx
  on public.todos (user_id, due_at);

comment on column public.todos.description   is 'Optional long-form description (max 2000 chars).';
comment on column public.todos.due_at        is 'Optional deadline. NULL = no due date.';
comment on column public.todos.priority      is 'low | medium | high. Default medium.';
comment on column public.todos.estimated_min is 'Optional effort estimate in minutes (1..1440).';
