-- Add an optional free-text meal description to glucose_readings.
-- Useful for capturing what was eaten alongside an after-meal reading.
--
-- Idempotent: safe to re-run.

alter table public.glucose_readings
  add column if not exists meal_description text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'glucose_readings_meal_description_length'
      and conrelid = 'public.glucose_readings'::regclass
  ) then
    alter table public.glucose_readings
      add constraint glucose_readings_meal_description_length
      check (meal_description is null or char_length(meal_description) <= 500);
  end if;
end $$;

comment on column public.glucose_readings.meal_description is
  'Optional free-text description of what was eaten, for after-meal readings (max 500 chars).';
