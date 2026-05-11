-- Post-deploy sanity checks. Run with `psql -v ON_ERROR_STOP=1 -f invariants.sql`.
-- Each check raises an exception on failure; the CI step fails accordingly.
-- Add to this file when you add new tables / policies — never remove a check
-- without writing a corresponding migration that explains why.

do $$
declare
  tables_without_rls text;
  missing_tables text;
  tables_without_policies text;
begin
  -- 1. Every public table must have RLS enabled.
  select string_agg(c.relname, ', ' order by c.relname) into tables_without_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;
  if tables_without_rls is not null then
    raise exception 'invariant failed: RLS is disabled on public tables: %', tables_without_rls;
  end if;

  -- 2. Expected tables exist. Update this list as new tables are added.
  select string_agg(t, ', ' order by t) into missing_tables
  from (values
    ('profiles'),
    ('activities'),
    ('activity_completions'),
    ('workouts'),
    ('workout_exercises'),
    ('period_logs'),
    ('glucose_readings'),
    ('todos')
  ) as expected(t)
  where not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = expected.t
  );
  if missing_tables is not null then
    raise exception 'invariant failed: expected public tables missing: %', missing_tables;
  end if;

  -- 3. Every public table must have at least one policy (otherwise RLS-on means
  --    "deny all" and the app silently breaks).
  select string_agg(c.relname, ', ' order by c.relname) into tables_without_policies
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relrowsecurity
    and not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = c.relname
    );
  if tables_without_policies is not null then
    raise exception 'invariant failed: RLS-enabled tables with no policies: %', tables_without_policies;
  end if;
end
$$;

select 'invariants ok' as status;
