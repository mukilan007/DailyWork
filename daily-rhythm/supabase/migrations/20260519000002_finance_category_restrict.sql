-- ============================================================================
-- Tighten category FK so deleting a category can't silently strip its
-- references off existing transactions.
--
-- Previously: finance_transactions.category_id used ON DELETE SET NULL, which
-- meant deleting a category (or its parent, via the cascading parent_id FK)
-- would quietly wipe the category off any transaction that still used it.
-- Now: ON DELETE RESTRICT — the DB blocks the delete and the app surfaces a
-- friendly "this category is in use" message.
-- ============================================================================
alter table public.finance_transactions
  drop constraint if exists finance_transactions_category_id_fkey;

alter table public.finance_transactions
  add constraint finance_transactions_category_id_fkey
  foreign key (category_id)
  references public.finance_categories(id)
  on delete restrict;
