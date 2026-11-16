create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (full_name is null or char_length(full_name) <= 120),
  phone text check (phone is null or char_length(phone) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id text not null check (plan_id in ('free', 'basic', 'popular', 'creator', 'pro_1tb', 'enterprise')),
  billing_period text not null check (billing_period in ('free', 'monthly', 'yearly')),
  status text not null check (status in ('active', 'cancelled', 'expired', 'past_due', 'paused', 'on_trial', 'unpaid')),
  provider text not null check (provider in ('free', 'lemon_squeezy')),
  external_subscription_id text unique,
  started_at timestamptz not null default now(),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  provider_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_started_at_idx
  on public.subscriptions (user_id, started_at desc);

alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.subscriptions from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
grant select on public.subscriptions to authenticated;

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users can view their own subscriptions" on public.subscriptions;
create policy "Users can view their own subscriptions"
  on public.subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  insert into public.subscriptions (user_id, plan_id, billing_period, status, provider)
  values (new.id, 'free', 'free', 'active', 'free')
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_dashboard on auth.users;
create trigger on_auth_user_created_dashboard
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

insert into public.profiles (id)
select users.id
from auth.users as users
on conflict (id) do nothing;

insert into public.subscriptions (user_id, plan_id, billing_period, status, provider)
select users.id, 'free', 'free', 'active', 'free'
from auth.users as users
where coalesce(users.raw_user_meta_data ->> 'plan_id', 'free') = 'free'
  and not exists (
    select 1
    from public.subscriptions as existing
    where existing.user_id = users.id
  );

create or replace function public.sync_paid_subscription(
  p_user_id uuid,
  p_plan_id text,
  p_billing_period text,
  p_status text,
  p_external_subscription_id text,
  p_started_at timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_provider_updated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  if p_plan_id not in ('basic', 'popular', 'creator', 'pro_1tb', 'enterprise') then
    raise exception 'Unsupported paid plan';
  end if;

  insert into public.subscriptions (
    user_id,
    plan_id,
    billing_period,
    status,
    provider,
    external_subscription_id,
    started_at,
    current_period_end,
    cancel_at_period_end,
    provider_updated_at
  )
  values (
    p_user_id,
    p_plan_id,
    p_billing_period,
    p_status,
    'lemon_squeezy',
    p_external_subscription_id,
    p_started_at,
    p_current_period_end,
    p_cancel_at_period_end,
    p_provider_updated_at
  )
  on conflict (external_subscription_id) do update
  set
    plan_id = excluded.plan_id,
    billing_period = excluded.billing_period,
    status = excluded.status,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    provider_updated_at = excluded.provider_updated_at
  where public.subscriptions.user_id = excluded.user_id
    and public.subscriptions.provider_updated_at < excluded.provider_updated_at;

  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    return;
  end if;

  update public.subscriptions
  set status = 'expired', current_period_end = p_started_at
  where user_id = p_user_id
    and provider = 'free'
    and status = 'active';
end;
$$;

revoke all on function public.sync_paid_subscription(
  uuid, text, text, text, text, timestamptz, timestamptz, boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.sync_paid_subscription(
  uuid, text, text, text, text, timestamptz, timestamptz, boolean, timestamptz
) to service_role;
