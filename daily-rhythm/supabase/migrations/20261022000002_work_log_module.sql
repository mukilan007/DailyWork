-- Work log: module field (2026-10-22).
--
-- A second grouping dimension alongside `category`. Category is the kind of
-- work (Backend, Review); module is the part of the product it touched
-- (Finance, Todos, Auth). Free text, like category — the UI suggests
-- previously-used values rather than maintaining a lookup table.
--
-- Additive + idempotent: a new nullable column, so every existing row stays
-- valid and untouched with `module` NULL. Nothing is read, rewritten or lost.

alter table public.work_log
  add column if not exists module text
    constraint work_log_module_len check (module is null or length(module) <= 100);

-- Mirrors work_log_user_category_idx: powers the suggestion list and the
-- per-module roll-up in the report without a full scan.
create index if not exists work_log_user_module_idx
  on public.work_log (user_id, module);
