-- Self-service account deletion.
--
-- Frontend clients cannot delete rows from `auth.users` directly (the auth
-- schema is not exposed via PostgREST). We expose a tightly-scoped
-- SECURITY DEFINER function that lets the *currently authenticated* user
-- delete their own auth row. All `public.*` tables reference
-- `auth.users(id) on delete cascade`, so the cascade wipes every row owned
-- by that user in a single transaction.
--
-- Idempotent: safe to re-run.

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

  -- Cascades to all public.* tables via their `on delete cascade` FKs.
  delete from auth.users where id = uid;
end;
$$;

-- Lock the function down: only authenticated users may execute it, and
-- the function itself enforces that they can only delete their own row.
revoke all on function public.delete_user_account() from public;
revoke all on function public.delete_user_account() from anon;
grant execute on function public.delete_user_account() to authenticated;

comment on function public.delete_user_account() is
  'Deletes the calling user''s auth.users row; cascades remove all owned data.';
