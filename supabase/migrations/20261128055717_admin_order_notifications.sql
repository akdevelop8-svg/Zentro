create table if not exists public.admin_notifications (
  id text primary key,
  event_type text not null check (event_type in (
    'vip_purchase',
    'welfare_purchase',
    'deposit_request',
    'withdrawal_request'
  )),
  title text not null,
  message text not null,
  reference_id text not null,
  customer_id text,
  customer_name text not null,
  amount_etb numeric(12,2) not null check (amount_etb >= 0),
  target_section text not null check (target_section in ('customers','deposits','withdrawals')),
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  constraint admin_notifications_event_reference_key unique (event_type, reference_id)
);

create index if not exists admin_notifications_unread_created_at_idx
  on public.admin_notifications (created_at desc)
  where is_read = false;

alter table public.admin_notifications enable row level security;
revoke all on table public.admin_notifications from public, anon, authenticated;
grant select, insert, update on table public.admin_notifications to service_role;
