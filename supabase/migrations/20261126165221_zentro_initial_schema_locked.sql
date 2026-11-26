-- ZENTRO initial PostgreSQL schema. No customer data or credentials are included.
create table if not exists public.users (
 id text primary key, name text not null, phone text not null,
 phone_normalized text not null unique, password_hash text not null,
 role text not null default 'customer' check (role in ('customer','admin')),
 status text not null default 'Active' check (status in ('Active','Suspended')),
 invitation_code text not null unique, invited_by_code text,
 wallet_balance_etb numeric(14,2) not null default 0 check (wallet_balance_etb >= 0),
 total_deposit_etb numeric(14,2) not null default 0,
 total_withdraw_etb numeric(14,2) not null default 0,
 total_commission_etb numeric(14,2) not null default 0,
 last_check_in_at bigint, terms_accepted boolean not null default false,
 bank_account_name text, bank_account_number text, bank_method text default 'CBE',
 created_at timestamptz not null default now()
);
create table if not exists public.purchased_plans (
 id text primary key, user_id text not null references public.users(id), plan_id text not null,
 tier text not null, investment_etb numeric(14,2) not null, daily_income_etb numeric(14,2) not null,
 cycle_days integer not null, purchased_at timestamptz not null default now(),
 next_cycle_at bigint not null, status text not null default 'Active'
);
create table if not exists public.welfare_enrollments (
 id text primary key, user_id text not null references public.users(id), plan_id text not null,
 plan_name text not null, investment_etb numeric(14,2) not null, daily_amount_etb numeric(14,2) not null,
 duration_days integer not null, claimed_days integer not null default 0,
 accumulated_etb numeric(14,2) not null default 0, started_at timestamptz not null default now(),
 started_at_ms bigint not null, matures_at_ms bigint not null, last_claim_at_ms bigint,
 status text not null default 'Active', released_at timestamptz
);
create table if not exists public.check_in_history (
 id text primary key, user_id text not null references public.users(id),
 reward_etb numeric(14,2) not null, claimed_at timestamptz not null default now()
);
create table if not exists public.deposit_requests (
 id text primary key, user_id text not null references public.users(id),
 amount_etb numeric(14,2) not null check (amount_etb > 0),
 reference_code text not null unique, payment_method_id text not null,
 payment_method_name text not null, account_name text not null, account_number text not null,
 receipt_filename text not null default '',
 status text not null default 'Pending' check (status in ('Pending','Approved','Rejected')),
 rejection_reason text, reviewed_by text, reviewed_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.withdrawal_requests (
 id text primary key, user_id text not null references public.users(id),
 amount_etb numeric(14,2) not null check (amount_etb > 0), fee_etb numeric(14,2) not null,
 net_amount_etb numeric(14,2) not null, payment_method_id text not null,
 payment_method_name text not null, customer_account_name text not null,
 customer_account_number text not null,
 status text not null default 'Pending' check (status in ('Pending','Approved','Rejected','Processed')),
 rejection_reason text, reviewed_by text, processed_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.feedback_messages (
 id text primary key, user_id text not null references public.users(id), category text not null,
 subject text not null, message text not null, status text not null default 'Unread',
 admin_reply text, replied_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.broadcast_messages (
 id text primary key, title text not null, message text not null, image_filename text,
 target_user_id text, created_by text not null, created_at timestamptz not null default now()
);
create table if not exists public.notifications (
 id text primary key, user_id text not null references public.users(id), title text not null,
 message text not null, image_filename text, type text not null default 'info',
 is_read boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.payment_settings (
 id text primary key, deposit_methods_json jsonb not null default '[]'::jsonb,
 withdrawal_methods_json jsonb not null default '[]'::jsonb,
 withdrawal_start_hour integer not null default 4, withdrawal_end_hour integer not null default 23,
 enforce_withdrawal_hours boolean not null default false,
 withdrawal_schedule_note text not null default '',
 min_withdrawal_etb numeric(14,2) not null default 150,
 min_recharge_etb numeric(14,2) not null default 700,
 withdrawal_fee_percent numeric(6,3) not null default 17,
 registration_bonus_etb numeric(14,2) not null default 150,
 daily_check_in_etb numeric(14,2) not null default 5,
 level1_commission_percent numeric(6,3) not null default 15,
 level2_commission_percent numeric(6,3) not null default 2,
 level3_commission_percent numeric(6,3) not null default 1,
 updated_at timestamptz not null default now()
);
create table if not exists public.audit_logs (
 id text primary key, actor text not null, action text not null,
 target text not null, details text, created_at timestamptz not null default now()
);
create table if not exists public.activities (
 id text primary key, user_id text not null references public.users(id),
 action text not null, plan_tier text not null, status text not null,
 created_at timestamptz not null default now()
);
create table if not exists public.app_secrets (key text primary key, value text not null);
insert into public.payment_settings (id) values ('default') on conflict (id) do nothing;
