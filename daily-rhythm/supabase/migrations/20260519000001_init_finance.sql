-- Finance / Expense Tracker — accounts, categories, transactions, budgets, recurrences.
-- Idempotent: safe to re-run. Each table has RLS locked to auth.uid() = user_id.

-- ============================================================================
-- finance_accounts — wallets / bank accounts / cards
-- ============================================================================
create table if not exists public.finance_accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0 and length(name) <= 60),
  account_type  text not null check (account_type in ('cash', 'account', 'card', 'savings', 'other')),
  position      integer not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists finance_accounts_user_idx
  on public.finance_accounts (user_id, position, created_at);

alter table public.finance_accounts enable row level security;

drop policy if exists finance_accounts_select_own on public.finance_accounts;
drop policy if exists finance_accounts_insert_own on public.finance_accounts;
drop policy if exists finance_accounts_update_own on public.finance_accounts;
drop policy if exists finance_accounts_delete_own on public.finance_accounts;
create policy finance_accounts_select_own on public.finance_accounts for select using (auth.uid() = user_id);
create policy finance_accounts_insert_own on public.finance_accounts for insert with check (auth.uid() = user_id);
create policy finance_accounts_update_own on public.finance_accounts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy finance_accounts_delete_own on public.finance_accounts for delete using (auth.uid() = user_id);

-- ============================================================================
-- finance_categories — two-level (parent + children via self-ref)
-- ============================================================================
create table if not exists public.finance_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0 and length(name) <= 60),
  kind        text not null check (kind in ('income', 'expense')),
  parent_id   uuid references public.finance_categories(id) on delete cascade,
  position    integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists finance_categories_user_idx
  on public.finance_categories (user_id, kind, parent_id, position);

alter table public.finance_categories enable row level security;

drop policy if exists finance_categories_select_own on public.finance_categories;
drop policy if exists finance_categories_insert_own on public.finance_categories;
drop policy if exists finance_categories_update_own on public.finance_categories;
drop policy if exists finance_categories_delete_own on public.finance_categories;
create policy finance_categories_select_own on public.finance_categories for select using (auth.uid() = user_id);
create policy finance_categories_insert_own on public.finance_categories for insert with check (auth.uid() = user_id);
create policy finance_categories_update_own on public.finance_categories for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy finance_categories_delete_own on public.finance_categories for delete using (auth.uid() = user_id);

-- ============================================================================
-- finance_recurrences — templates that auto-materialise transactions
-- ============================================================================
create table if not exists public.finance_recurrences (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  template_json         jsonb not null,
  frequency             text not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  interval_n            integer not null default 1 check (interval_n between 1 and 365),
  start_on              date not null,
  end_on                date,
  last_materialised_on  date,
  created_at            timestamptz not null default now()
);
create index if not exists finance_recurrences_user_idx
  on public.finance_recurrences (user_id, last_materialised_on);

alter table public.finance_recurrences enable row level security;

drop policy if exists finance_recurrences_select_own on public.finance_recurrences;
drop policy if exists finance_recurrences_insert_own on public.finance_recurrences;
drop policy if exists finance_recurrences_update_own on public.finance_recurrences;
drop policy if exists finance_recurrences_delete_own on public.finance_recurrences;
create policy finance_recurrences_select_own on public.finance_recurrences for select using (auth.uid() = user_id);
create policy finance_recurrences_insert_own on public.finance_recurrences for insert with check (auth.uid() = user_id);
create policy finance_recurrences_update_own on public.finance_recurrences for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy finance_recurrences_delete_own on public.finance_recurrences for delete using (auth.uid() = user_id);

-- ============================================================================
-- finance_transactions — income / expense / transfer entries
-- ============================================================================
create table if not exists public.finance_transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  kind            text not null check (kind in ('income', 'expense', 'transfer')),
  occurred_on     date not null,
  occurred_at     timestamptz not null default now(),
  account_id      uuid not null references public.finance_accounts(id) on delete restrict,
  to_account_id   uuid references public.finance_accounts(id) on delete restrict,
  category_id     uuid references public.finance_categories(id) on delete set null,
  amount_paise    bigint not null check (amount_paise > 0),
  fees_paise      bigint not null default 0 check (fees_paise >= 0),
  note            text,
  recurrence_id   uuid references public.finance_recurrences(id) on delete set null,
  created_at      timestamptz not null default now(),
  -- Transfer rows must have to_account; non-transfers must not.
  constraint finance_transactions_transfer_shape check (
    (kind = 'transfer' and to_account_id is not null and category_id is null)
    or (kind <> 'transfer' and to_account_id is null)
  )
);
create index if not exists finance_transactions_user_date_idx
  on public.finance_transactions (user_id, occurred_on desc);
create index if not exists finance_transactions_user_kind_date_idx
  on public.finance_transactions (user_id, kind, occurred_on desc);
create index if not exists finance_transactions_user_category_idx
  on public.finance_transactions (user_id, category_id);

alter table public.finance_transactions enable row level security;

drop policy if exists finance_transactions_select_own on public.finance_transactions;
drop policy if exists finance_transactions_insert_own on public.finance_transactions;
drop policy if exists finance_transactions_update_own on public.finance_transactions;
drop policy if exists finance_transactions_delete_own on public.finance_transactions;
create policy finance_transactions_select_own on public.finance_transactions for select using (auth.uid() = user_id);
create policy finance_transactions_insert_own on public.finance_transactions for insert with check (auth.uid() = user_id);
create policy finance_transactions_update_own on public.finance_transactions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy finance_transactions_delete_own on public.finance_transactions for delete using (auth.uid() = user_id);

-- ============================================================================
-- finance_budgets — monthly budget per category (or overall if category_id is null)
-- ============================================================================
create table if not exists public.finance_budgets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  category_id   uuid references public.finance_categories(id) on delete cascade,
  month         date not null,
  amount_paise  bigint not null check (amount_paise >= 0),
  created_at    timestamptz not null default now(),
  -- Postgres treats NULLs as distinct in unique indexes by default. Use a
  -- partial index pair so "one overall budget per month" is enforceable too.
  unique (user_id, category_id, month)
);
create unique index if not exists finance_budgets_overall_month_uniq
  on public.finance_budgets (user_id, month)
  where category_id is null;
create index if not exists finance_budgets_user_month_idx
  on public.finance_budgets (user_id, month);

alter table public.finance_budgets enable row level security;

drop policy if exists finance_budgets_select_own on public.finance_budgets;
drop policy if exists finance_budgets_insert_own on public.finance_budgets;
drop policy if exists finance_budgets_update_own on public.finance_budgets;
drop policy if exists finance_budgets_delete_own on public.finance_budgets;
create policy finance_budgets_select_own on public.finance_budgets for select using (auth.uid() = user_id);
create policy finance_budgets_insert_own on public.finance_budgets for insert with check (auth.uid() = user_id);
create policy finance_budgets_update_own on public.finance_budgets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy finance_budgets_delete_own on public.finance_budgets for delete using (auth.uid() = user_id);
