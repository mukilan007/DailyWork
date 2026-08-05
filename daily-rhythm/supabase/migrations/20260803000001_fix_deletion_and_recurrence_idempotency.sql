-- Bug fixes (2026-08-03):
--
-- 1. Recurrence materialisation had no idempotency guard, so concurrent runs
--    (React StrictMode double-effects, two open tabs) inserted duplicate
--    transactions. Dedupe existing rows and add a unique index on
--    (recurrence_id, occurred_on); the client now upserts with
--    `ignoreDuplicates` against it. Manual transactions have a NULL
--    recurrence_id and are unaffected (NULLs never conflict).
--
-- 2. delete_user_account() relied on `on delete cascade` from auth.users,
--    but finance_transactions.account_id / to_account_id reference
--    finance_accounts with ON DELETE RESTRICT — the cascade into
--    finance_accounts hits the RESTRICT while the user's transactions still
--    exist, so account deletion failed for any user with transactions.
--    Fix: delete the user's transactions explicitly before auth.users.
--
-- 3. public.todos had no FK to auth.users at all, so deleted users' todos
--    were orphaned forever. Clean up orphans and add the missing cascade FK.
--
-- Idempotent: safe to re-run.

-- 1a. Remove duplicates produced by the race (keep one row per occurrence).
delete from public.finance_transactions t
using public.finance_transactions dup
where t.recurrence_id is not null
  and t.recurrence_id = dup.recurrence_id
  and t.occurred_on   = dup.occurred_on
  and t.ctid > dup.ctid;

-- 1b. Enforce one materialised transaction per recurrence per day.
create unique index if not exists finance_tx_recurrence_occurrence_uidx
  on public.finance_transactions (recurrence_id, occurred_on);

-- 2. Delete transactions before the auth.users cascade reaches
--    finance_accounts (whose FKs are RESTRICT by design for in-app deletes).
create or replace function public.delete_user_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- finance_transactions -> finance_accounts is ON DELETE RESTRICT, so the
  -- auth.users cascade cannot clear it; delete explicitly first.
  delete from public.finance_transactions where user_id = uid;

  -- Cascades to all remaining public.* tables via their FKs.
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_user_account() from public;
revoke all on function public.delete_user_account() from anon;
grant execute on function public.delete_user_account() to authenticated;

comment on function public.delete_user_account() is
  'Deletes the calling user''s auth.users row; cascades remove all owned data.';

-- 3. todos: clean orphans, then add the missing cascade FK.
delete from public.todos
where user_id not in (select id from auth.users);

alter table public.todos
  drop constraint if exists todos_user_id_fkey;
alter table public.todos
  add constraint todos_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
