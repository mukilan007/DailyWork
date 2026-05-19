-- ============================================================================
-- (No-op) The earlier draft of this migration switched
-- finance_transactions.category_id to ON DELETE RESTRICT to prevent silent
-- nulling of transactions when their category was deleted.
--
-- We now solve the same problem at the application layer via soft-delete
-- (categories get `archived_at = now()` instead of being physically removed),
-- and the FK should stay ON DELETE SET NULL so that the ON DELETE CASCADE
-- from user_id can clean up both tables when a user account is deleted
-- without ordering conflicts.
--
-- This file is kept (rather than deleted) to preserve migration history
-- ordering on installs that already applied the previous version. It
-- re-asserts the original FK definition idempotently.
-- ============================================================================
alter table public.finance_transactions
  drop constraint if exists finance_transactions_category_id_fkey;

alter table public.finance_transactions
  add constraint finance_transactions_category_id_fkey
  foreign key (category_id)
  references public.finance_categories(id)
  on delete set null;
