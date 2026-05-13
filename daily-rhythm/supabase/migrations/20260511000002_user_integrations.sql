-- user_integrations — connection state per external provider, per user.
-- Idempotent: safe to re-run.

create table if not exists public.user_integrations (
  user_id       uuid not null references auth.users(id) on delete cascade,
  provider      text not null check (provider in ('hevy', 'google_fit', 'fitbit', 'apple_health')),
  status        text not null default 'connected' check (status in ('connected', 'pending', 'disconnected')),
  connected_at  timestamptz not null default now(),
  last_sync_at  timestamptz,
  credentials   jsonb not null default '{}'::jsonb,
  notes         text,
  primary key (user_id, provider)
);

-- Helpful for "is this provider connected for this user?" lookups.
create index if not exists user_integrations_user_status_idx
  on public.user_integrations (user_id, status);

alter table public.user_integrations enable row level security;

drop policy if exists user_integrations_select_own on public.user_integrations;
drop policy if exists user_integrations_insert_own on public.user_integrations;
drop policy if exists user_integrations_update_own on public.user_integrations;
drop policy if exists user_integrations_delete_own on public.user_integrations;

create policy user_integrations_select_own on public.user_integrations
  for select using (auth.uid() = user_id);
create policy user_integrations_insert_own on public.user_integrations
  for insert with check (auth.uid() = user_id);
create policy user_integrations_update_own on public.user_integrations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy user_integrations_delete_own on public.user_integrations
  for delete using (auth.uid() = user_id);
