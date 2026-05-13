-- Add a `category` column to activities so habits can be grouped/filtered.
-- Idempotent: safe to re-run.

alter table public.activities
  add column if not exists category text;

-- Constrain to a known set of categories. Null is allowed for legacy rows
-- and for users who haven't picked a category yet.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'activities_category_check'
      and conrelid = 'public.activities'::regclass
  ) then
    alter table public.activities
      add constraint activities_category_check
      check (
        category is null or category in ('health', 'fitness', 'mind', 'work', 'self_care')
      );
  end if;
end $$;

create index if not exists activities_user_category_idx
  on public.activities (user_id, category);
