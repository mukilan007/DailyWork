-- Expand glucose_readings.meal_context to allow per-meal contexts
-- (before/after breakfast, lunch, dinner) in addition to the original
-- generic before_meal / after_meal / random values, which we keep for
-- backwards compatibility with existing rows.
--
-- Idempotent: safe to re-run.

do $$
declare
  con_name text;
begin
  -- Drop any existing CHECK on meal_context (auto-named by Postgres on the init migration).
  for con_name in
    select conname
    from pg_constraint
    where conrelid = 'public.glucose_readings'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%meal_context%'
  loop
    execute format('alter table public.glucose_readings drop constraint %I', con_name);
  end loop;
end $$;

alter table public.glucose_readings
  add constraint glucose_readings_meal_context_check
  check (
    meal_context is null or meal_context in (
      'fasting',
      'before_breakfast',
      'after_breakfast',
      'before_lunch',
      'after_lunch',
      'before_dinner',
      'after_dinner',
      'bedtime',
      -- Legacy values from earlier schema; existing rows may still use these.
      'before_meal',
      'after_meal',
      'random'
    )
  );

comment on column public.glucose_readings.meal_context is
  'Time-of-day context for the reading. Preferred values: fasting, before_breakfast, after_breakfast, before_lunch, after_lunch, before_dinner, after_dinner, bedtime. Legacy: before_meal, after_meal, random.';
