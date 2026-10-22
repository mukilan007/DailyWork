-- Entry type for work log + todos (2026-10-22).
--
-- Splits a record into the kind of thing it is, so the report can present it
-- the right way: 'task' reads as prose, while 'customer_issue' and
-- 'bugtracker' are tabular by nature and render as tables.
--
-- Additive + idempotent. Both columns are NOT NULL with a 'task' default, so
-- every existing row keeps its current meaning (they were all tasks) and no
-- data is read, rewritten or lost.

alter table public.work_log
  add column if not exists entry_type text not null default 'task'
    constraint work_log_entry_type_chk
      check (entry_type in ('task', 'customer_issue', 'bugtracker'));

alter table public.todos
  add column if not exists entry_type text not null default 'task'
    constraint todos_entry_type_chk
      check (entry_type in ('task', 'customer_issue', 'bugtracker'));

-- The report groups by type, so both reads are indexed per user.
create index if not exists work_log_user_entry_type_idx
  on public.work_log (user_id, entry_type);
create index if not exists todos_user_entry_type_idx
  on public.todos (user_id, entry_type);
