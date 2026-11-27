-- ZENTRO Daily VIP and Welfare plan lifecycle.
-- Adds server-enforced expiry, 24-hour claims, and atomic wallet/vault accounting.

alter table public.purchased_plans
  add column if not exists claimed_days integer not null default 0,
  add column if not exists last_claim_at timestamptz,
  add column if not exists expires_at timestamptz;

update public.purchased_plans
set expires_at = purchased_at + make_interval(days => greatest(cycle_days, 1))
where expires_at is null;

alter table public.purchased_plans
  alter column expires_at set not null;

alter table public.purchased_plans
  drop constraint if exists purchased_plans_claimed_days_check;

alter table public.purchased_plans
  add constraint purchased_plans_claimed_days_check
  check (claimed_days >= 0 and claimed_days <= cycle_days);

alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_transaction_type_check;

alter table public.wallet_transactions
  add constraint wallet_transactions_transaction_type_check
  check (transaction_type in (
    'deposit_credit',
    'withdrawal_reserve',
    'withdrawal_refund',
    'vip_plan_purchase',
    'vip_daily_claim',
    'welfare_plan_purchase',
    'welfare_daily_claim',
    'welfare_release',
    'checkin_reward',
    'registration_bonus',
    'commission_credit',
    'gift_code_credit'
  ));

create index if not exists idx_purchased_plans_user_status_expiry
  on public.purchased_plans(user_id, status, expires_at);

create index if not exists idx_welfare_enrollments_user_status_maturity
  on public.welfare_enrollments(user_id, status, matures_at_ms);

create or replace function public.zentro_buy_vip_plan(
  p_user_id text,
  p_id text,
  p_plan_id text,
  p_tier text,
  p_investment numeric,
  p_daily_income numeric,
  p_cycle_days integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_before numeric(14,2);
  v_after numeric(14,2);
  v_now timestamptz := clock_timestamp();
  v_next_cycle_ms bigint;
  v_expires_at timestamptz;
begin
  if p_investment <= 0 or p_daily_income <= 0 or p_cycle_days < 1 or p_cycle_days > 365 then
    raise exception 'Invalid plan parameters';
  end if;

  select status, wallet_balance_etb
    into v_status, v_before
    from public.users
   where id = p_user_id and role = 'customer'
   for update;

  if not found or v_status <> 'Active' then
    raise exception 'Active customer account not found';
  end if;

  if v_before < p_investment then
    return jsonb_build_object('ok', false, 'error', 'Insufficient wallet balance');
  end if;

  v_after := v_before - p_investment;
  v_next_cycle_ms := floor(extract(epoch from (v_now + interval '24 hours')) * 1000)::bigint;
  v_expires_at := v_now + make_interval(days => p_cycle_days);

  update public.users
     set wallet_balance_etb = v_after
   where id = p_user_id;

  insert into public.purchased_plans(
    id, user_id, plan_id, tier, investment_etb, daily_income_etb,
    cycle_days, purchased_at, next_cycle_at, status,
    claimed_days, last_claim_at, expires_at
  ) values (
    p_id, p_user_id, p_plan_id, p_tier, p_investment, p_daily_income,
    p_cycle_days, v_now, v_next_cycle_ms, 'Active',
    0, null, v_expires_at
  );

  insert into public.wallet_transactions(
    id, user_id, transaction_type, amount_etb, balance_before_etb,
    balance_after_etb, reference_id, status, details
  ) values (
    'wtx-' || substr(gen_random_uuid()::text, 1, 16),
    p_user_id, 'vip_plan_purchase', -p_investment, v_before,
    v_after, p_id, 'Completed', 'Daily VIP plan purchase'
  );

  insert into public.activities(id, user_id, action, plan_tier, status, created_at)
  values ('act-' || substr(gen_random_uuid()::text, 1, 12), p_user_id,
          'Daily VIP Plan Purchased', p_tier, 'Completed', v_now);

  insert into public.notifications(id, user_id, title, message, type, is_read, created_at)
  values ('ntf-' || substr(gen_random_uuid()::text, 1, 12), p_user_id,
          'Daily VIP plan activated',
          p_tier || ' is active. Your first daily claim becomes available 24 hours after activation.',
          'success', false, v_now);

  insert into public.audit_logs(id, actor, action, target, details, created_at)
  values ('aud-' || substr(gen_random_uuid()::text, 1, 12), p_user_id,
          'Daily VIP plan purchased', p_id,
          'Plan ' || p_plan_id || '; investment ' || p_investment::text || ' ETB',
          v_now);

  return jsonb_build_object(
    'ok', true,
    'id', p_id,
    'walletBalanceEtb', v_after,
    'nextCycleAt', v_next_cycle_ms,
    'expiresAt', v_expires_at
  );
end;
$$;

create or replace function public.zentro_claim_vip_daily(
  p_user_id text,
  p_plan_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_status text;
  v_balance numeric(14,2);
  v_after numeric(14,2);
  v_plan public.purchased_plans%rowtype;
  v_now timestamptz := clock_timestamp();
  v_now_ms bigint;
  v_next_ms bigint;
  v_claimed_days integer;
  v_new_status text;
begin
  select status, wallet_balance_etb
    into v_user_status, v_balance
    from public.users
   where id = p_user_id and role = 'customer'
   for update;

  if not found or v_user_status <> 'Active' then
    raise exception 'Active customer account not found';
  end if;

  select *
    into v_plan
    from public.purchased_plans
   where id = p_plan_id and user_id = p_user_id
   for update;

  if not found then
    raise exception 'Purchased plan not found';
  end if;

  if v_plan.status <> 'Active' then
    return jsonb_build_object('ok', false, 'error', 'This plan is no longer active');
  end if;

  if v_now > v_plan.expires_at then
    update public.purchased_plans set status = 'Expired' where id = p_plan_id;
    return jsonb_build_object('ok', false, 'error', 'This plan has expired', 'status', 'Expired');
  end if;

  if v_plan.claimed_days >= v_plan.cycle_days then
    update public.purchased_plans set status = 'Expired' where id = p_plan_id;
    return jsonb_build_object('ok', false, 'error', 'All daily claims have been completed', 'status', 'Expired');
  end if;

  v_now_ms := floor(extract(epoch from v_now) * 1000)::bigint;
  if v_now_ms < v_plan.next_cycle_at then
    return jsonb_build_object(
      'ok', false,
      'error', 'Your next daily claim is not available yet',
      'nextCycleAt', v_plan.next_cycle_at,
      'remainingSeconds', ceil((v_plan.next_cycle_at - v_now_ms)::numeric / 1000)
    );
  end if;

  v_after := v_balance + v_plan.daily_income_etb;
  v_claimed_days := v_plan.claimed_days + 1;
  v_next_ms := v_now_ms + 86400000;
  v_new_status := case when v_claimed_days >= v_plan.cycle_days then 'Expired' else 'Active' end;

  update public.users
     set wallet_balance_etb = v_after
   where id = p_user_id;

  update public.purchased_plans
     set claimed_days = v_claimed_days,
         last_claim_at = v_now,
         next_cycle_at = v_next_ms,
         status = v_new_status
   where id = p_plan_id;

  insert into public.wallet_transactions(
    id, user_id, transaction_type, amount_etb, balance_before_etb,
    balance_after_etb, reference_id, status, details
  ) values (
    'wtx-' || substr(gen_random_uuid()::text, 1, 16),
    p_user_id, 'vip_daily_claim', v_plan.daily_income_etb, v_balance,
    v_after, p_plan_id, 'Completed',
    'Daily VIP claim ' || v_claimed_days::text || ' of ' || v_plan.cycle_days::text
  );

  insert into public.notifications(id, user_id, title, message, type, is_read, created_at)
  values ('ntf-' || substr(gen_random_uuid()::text, 1, 12), p_user_id,
          'Daily VIP claim completed',
          v_plan.daily_income_etb::text || ' ETB was credited to your wallet.',
          'success', false, v_now);

  insert into public.audit_logs(id, actor, action, target, details, created_at)
  values ('aud-' || substr(gen_random_uuid()::text, 1, 12), p_user_id,
          'Daily VIP claim', p_plan_id,
          'Claim ' || v_claimed_days::text || ' of ' || v_plan.cycle_days::text ||
          '; credited ' || v_plan.daily_income_etb::text || ' ETB',
          v_now);

  return jsonb_build_object(
    'ok', true,
    'claimedDays', v_claimed_days,
    'dailyIncomeEtb', v_plan.daily_income_etb,
    'walletBalanceEtb', v_after,
    'nextCycleAt', v_next_ms,
    'status', v_new_status
  );
end;
$$;

create or replace function public.zentro_buy_welfare_plan(
  p_user_id text,
  p_id text,
  p_plan_id text,
  p_plan_name text,
  p_investment numeric,
  p_daily_amount numeric,
  p_duration_days integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_before numeric(14,2);
  v_after numeric(14,2);
  v_now timestamptz := clock_timestamp();
  v_now_ms bigint;
  v_matures_ms bigint;
begin
  if p_investment <= 0 or p_daily_amount <= 0 or p_duration_days not in (5, 7) then
    raise exception 'Invalid Welfare plan parameters';
  end if;

  select status, wallet_balance_etb
    into v_status, v_before
    from public.users
   where id = p_user_id and role = 'customer'
   for update;

  if not found or v_status <> 'Active' then
    raise exception 'Active customer account not found';
  end if;

  if v_before < p_investment then
    return jsonb_build_object('ok', false, 'error', 'Insufficient wallet balance');
  end if;

  v_after := v_before - p_investment;
  v_now_ms := floor(extract(epoch from v_now) * 1000)::bigint;
  v_matures_ms := v_now_ms + (p_duration_days::bigint * 86400000);

  update public.users
     set wallet_balance_etb = v_after
   where id = p_user_id;

  insert into public.welfare_enrollments(
    id, user_id, plan_id, plan_name, investment_etb, daily_amount_etb,
    duration_days, claimed_days, accumulated_etb, started_at,
    started_at_ms, matures_at_ms, last_claim_at_ms, status
  ) values (
    p_id, p_user_id, p_plan_id, p_plan_name, p_investment, p_daily_amount,
    p_duration_days, 0, 0, v_now,
    v_now_ms, v_matures_ms, v_now_ms, 'Active'
  );

  insert into public.wallet_transactions(
    id, user_id, transaction_type, amount_etb, balance_before_etb,
    balance_after_etb, reference_id, status, details
  ) values (
    'wtx-' || substr(gen_random_uuid()::text, 1, 16),
    p_user_id, 'welfare_plan_purchase', -p_investment, v_before,
    v_after, p_id, 'Completed', 'Welfare plan purchase'
  );

  insert into public.activities(id, user_id, action, plan_tier, status, created_at)
  values ('act-' || substr(gen_random_uuid()::text, 1, 12), p_user_id,
          'Welfare Plan Purchased', p_plan_name, 'Completed', v_now);

  insert into public.notifications(id, user_id, title, message, type, is_read, created_at)
  values ('ntf-' || substr(gen_random_uuid()::text, 1, 12), p_user_id,
          'Welfare plan activated',
          'Your first daily Welfare claim becomes available 24 hours after activation. Your vault matures after ' || p_duration_days::text || ' days.',
          'success', false, v_now);

  insert into public.audit_logs(id, actor, action, target, details, created_at)
  values ('aud-' || substr(gen_random_uuid()::text, 1, 12), p_user_id,
          'Welfare plan purchased', p_id,
          'Plan ' || p_plan_id || '; investment ' || p_investment::text || ' ETB',
          v_now);

  return jsonb_build_object(
    'ok', true,
    'id', p_id,
    'walletBalanceEtb', v_after,
    'startedAtMs', v_now_ms,
    'maturesAtMs', v_matures_ms
  );
end;
$$;

create or replace function public.zentro_claim_welfare_daily(
  p_user_id text,
  p_enrollment_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_status text;
  v_balance numeric(14,2);
  v_enrollment public.welfare_enrollments%rowtype;
  v_now timestamptz := clock_timestamp();
  v_now_ms bigint;
  v_anchor_ms bigint;
  v_claimed_days integer;
  v_accumulated numeric(14,2);
begin
  select status, wallet_balance_etb
    into v_user_status, v_balance
    from public.users
   where id = p_user_id and role = 'customer'
   for update;

  if not found or v_user_status <> 'Active' then
    raise exception 'Active customer account not found';
  end if;

  select *
    into v_enrollment
    from public.welfare_enrollments
   where id = p_enrollment_id and user_id = p_user_id
   for update;

  if not found then
    raise exception 'Welfare enrollment not found';
  end if;

  if v_enrollment.status <> 'Active' then
    return jsonb_build_object('ok', false, 'error', 'This Welfare plan is no longer active');
  end if;

  if v_enrollment.claimed_days >= v_enrollment.duration_days then
    return jsonb_build_object('ok', false, 'error', 'All daily Welfare claims have been completed');
  end if;

  v_now_ms := floor(extract(epoch from v_now) * 1000)::bigint;
  v_anchor_ms := coalesce(v_enrollment.last_claim_at_ms, v_enrollment.started_at_ms);

  if v_now_ms < v_anchor_ms + 86400000 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Your next Welfare claim is not available yet',
      'remainingSeconds', ceil((v_anchor_ms + 86400000 - v_now_ms)::numeric / 1000)
    );
  end if;

  v_claimed_days := v_enrollment.claimed_days + 1;
  v_accumulated := v_enrollment.accumulated_etb + v_enrollment.daily_amount_etb;

  update public.welfare_enrollments
     set claimed_days = v_claimed_days,
         accumulated_etb = v_accumulated,
         last_claim_at_ms = v_now_ms
   where id = p_enrollment_id;

  insert into public.wallet_transactions(
    id, user_id, transaction_type, amount_etb, balance_before_etb,
    balance_after_etb, reference_id, status, details
  ) values (
    'wtx-' || substr(gen_random_uuid()::text, 1, 16),
    p_user_id, 'welfare_daily_claim', v_enrollment.daily_amount_etb,
    v_balance, v_balance, p_enrollment_id, 'Completed',
    'Welfare vault credit ' || v_claimed_days::text || ' of ' || v_enrollment.duration_days::text
  );

  insert into public.notifications(id, user_id, title, message, type, is_read, created_at)
  values ('ntf-' || substr(gen_random_uuid()::text, 1, 12), p_user_id,
          'Welfare daily claim saved',
          v_enrollment.daily_amount_etb::text || ' ETB was added to your locked Welfare Vault.',
          'success', false, v_now);

  insert into public.audit_logs(id, actor, action, target, details, created_at)
  values ('aud-' || substr(gen_random_uuid()::text, 1, 12), p_user_id,
          'Welfare daily claim', p_enrollment_id,
          'Claim ' || v_claimed_days::text || ' of ' || v_enrollment.duration_days::text ||
          '; saved ' || v_enrollment.daily_amount_etb::text || ' ETB',
          v_now);

  return jsonb_build_object(
    'ok', true,
    'claimedDays', v_claimed_days,
    'accumulatedEtb', v_accumulated,
    'releasedToWallet', false,
    'walletBalanceEtb', v_balance
  );
end;
$$;

create or replace function public.zentro_release_welfare_vault(
  p_user_id text,
  p_enrollment_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_status text;
  v_before numeric(14,2);
  v_after numeric(14,2);
  v_enrollment public.welfare_enrollments%rowtype;
  v_now timestamptz := clock_timestamp();
  v_now_ms bigint;
  v_release numeric(14,2);
begin
  select status, wallet_balance_etb
    into v_user_status, v_before
    from public.users
   where id = p_user_id and role = 'customer'
   for update;

  if not found or v_user_status <> 'Active' then
    raise exception 'Active customer account not found';
  end if;

  select *
    into v_enrollment
    from public.welfare_enrollments
   where id = p_enrollment_id and user_id = p_user_id
   for update;

  if not found then
    raise exception 'Welfare enrollment not found';
  end if;

  if v_enrollment.status <> 'Active' then
    return jsonb_build_object('ok', false, 'error', 'This Welfare vault has already been released or closed');
  end if;

  v_now_ms := floor(extract(epoch from v_now) * 1000)::bigint;
  if v_now_ms < v_enrollment.matures_at_ms then
    return jsonb_build_object('ok', false, 'error', 'Your Welfare vault has not reached maturity yet');
  end if;

  v_release := v_enrollment.accumulated_etb;
  if v_release <= 0 then
    return jsonb_build_object('ok', false, 'error', 'There is no accumulated Welfare amount to release');
  end if;

  v_after := v_before + v_release;

  update public.users
     set wallet_balance_etb = v_after
   where id = p_user_id;

  update public.welfare_enrollments
     set status = 'Completed',
         released_at = v_now
   where id = p_enrollment_id;

  insert into public.wallet_transactions(
    id, user_id, transaction_type, amount_etb, balance_before_etb,
    balance_after_etb, reference_id, status, details
  ) values (
    'wtx-' || substr(gen_random_uuid()::text, 1, 16),
    p_user_id, 'welfare_release', v_release, v_before,
    v_after, p_enrollment_id, 'Completed', 'Matured Welfare Vault released to wallet'
  );

  insert into public.notifications(id, user_id, title, message, type, is_read, created_at)
  values ('ntf-' || substr(gen_random_uuid()::text, 1, 12), p_user_id,
          'Welfare vault released',
          v_release::text || ' ETB was moved from your Welfare Vault to your wallet.',
          'success', false, v_now);

  insert into public.audit_logs(id, actor, action, target, details, created_at)
  values ('aud-' || substr(gen_random_uuid()::text, 1, 12), p_user_id,
          'Welfare vault released', p_enrollment_id,
          'Released ' || v_release::text || ' ETB to wallet',
          v_now);

  return jsonb_build_object(
    'ok', true,
    'releasedEtb', v_release,
    'walletBalanceEtb', v_after
  );
end;
$$;

revoke all on function public.zentro_buy_vip_plan(text,text,text,text,numeric,numeric,integer) from public, anon, authenticated;
revoke all on function public.zentro_claim_vip_daily(text,text) from public, anon, authenticated;
revoke all on function public.zentro_buy_welfare_plan(text,text,text,text,numeric,numeric,integer) from public, anon, authenticated;
revoke all on function public.zentro_claim_welfare_daily(text,text) from public, anon, authenticated;
revoke all on function public.zentro_release_welfare_vault(text,text) from public, anon, authenticated;

grant execute on function public.zentro_buy_vip_plan(text,text,text,text,numeric,numeric,integer) to service_role;
grant execute on function public.zentro_claim_vip_daily(text,text) to service_role;
grant execute on function public.zentro_buy_welfare_plan(text,text,text,text,numeric,numeric,integer) to service_role;
grant execute on function public.zentro_claim_welfare_daily(text,text) to service_role;
grant execute on function public.zentro_release_welfare_vault(text,text) to service_role;
