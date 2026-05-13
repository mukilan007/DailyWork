-- Allow "other" as a valid activity category in addition to the existing set.
-- The original CHECK was added in 20260511000001_activities_add_category.sql.
-- We drop and recreate it instead of altering, because Postgres doesn't
-- support ALTER CONSTRAINT for CHECK predicates.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'activities_category_check'
      and conrelid = 'public.activities'::regclass
  ) then
    alter table public.activities
      drop constraint activities_category_check;
  end if;

  alter table public.activities
    add constraint activities_category_check
    check (
      category is null
      or category in ('health', 'fitness', 'mind', 'work', 'self_care', 'other')
    );
end $$;
