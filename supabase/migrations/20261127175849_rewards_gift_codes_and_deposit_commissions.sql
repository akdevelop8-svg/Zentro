-- Rewards, gift-code redemption, registration bonus and three-level verified-deposit commission.
-- All financial release settings remain disabled by default.
alter table public.payment_settings
  add column if not exists commission_base text not null default 'none';
alter table public.payment_settings drop constraint if exists payment_settings_commission_base_check;
alter table public.payment_settings add constraint payment_settings_commission_base_check
  check (commission_base in ('none','verified_deposit'));

create table if not exists public.gift_codes (
  code text primary key,
  amount_etb numeric(14,2) not null check (amount_etb > 0),
  max_redemptions integer not null default 1 check (max_redemptions between 1 and 10000),
  redemption_count integer not null default 0 check (redemption_count >= 0 and redemption_count <= max_redemptions),
  status text not null default 'Active' check (status in ('Active','Revoked','Exhausted')),
  expires_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.gift_code_redemptions (
  id text primary key,
  code text not null references public.gift_codes(code) on delete restrict,
  user_id text not null references public.users(id) on delete restrict,
  amount_etb numeric(14,2) not null check (amount_etb > 0),
  redeemed_at timestamptz not null default now(),
  unique(code,user_id)
);
create index if not exists gift_codes_status_expiry_idx on public.gift_codes(status,expires_at);
create index if not exists gift_code_redemptions_user_idx on public.gift_code_redemptions(user_id,redeemed_at desc);
create unique index if not exists wallet_transactions_idempotency_idx
  on public.wallet_transactions(user_id,transaction_type,reference_id);

alter table public.gift_codes enable row level security;
alter table public.gift_codes force row level security;
alter table public.gift_code_redemptions enable row level security;
alter table public.gift_code_redemptions force row level security;
revoke all on public.gift_codes from public,anon,authenticated;
revoke all on public.gift_code_redemptions from public,anon,authenticated;
grant all on public.gift_codes to service_role;
grant all on public.gift_code_redemptions to service_role;

create or replace function public.zentro_redeem_gift_code(p_user_id text,p_code text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_code public.gift_codes%rowtype;
  v_before numeric;
  v_after numeric;
  v_redemption_id text := 'gcr-' || substr(gen_random_uuid()::text,1,16);
  v_now timestamptz := now();
begin
  if p_code is null or length(btrim(p_code))<4 or length(btrim(p_code))>40 then raise exception 'Enter a valid gift code'; end if;
  select * into v_code from public.gift_codes where code=upper(btrim(p_code)) for update;
  if not found then raise exception 'Gift code not found'; end if;
  if v_code.status<>'Active' then raise exception 'Gift code is not active'; end if;
  if v_code.expires_at is not null and v_code.expires_at<=v_now then
    update public.gift_codes set status='Exhausted' where code=v_code.code;
    raise exception 'Gift code has expired';
  end if;
  if v_code.redemption_count>=v_code.max_redemptions then
    update public.gift_codes set status='Exhausted' where code=v_code.code;
    raise exception 'Gift code has already been fully redeemed';
  end if;
  perform 1 from public.users where id=p_user_id and role='customer' and status='Active' for update;
  if not found then raise exception 'Active customer account not found'; end if;
  if exists(select 1 from public.gift_code_redemptions where code=v_code.code and user_id=p_user_id) then
    raise exception 'This gift code has already been redeemed by your account';
  end if;
  select wallet_balance_etb into v_before from public.users where id=p_user_id;
  update public.users set wallet_balance_etb=wallet_balance_etb+v_code.amount_etb
    where id=p_user_id returning wallet_balance_etb into v_after;
  insert into public.gift_code_redemptions(id,code,user_id,amount_etb,redeemed_at)
    values(v_redemption_id,v_code.code,p_user_id,v_code.amount_etb,v_now);
  update public.gift_codes set redemption_count=redemption_count+1,
    status=case when redemption_count+1>=max_redemptions then 'Exhausted' else 'Active' end
    where code=v_code.code;
  insert into public.wallet_transactions(id,user_id,transaction_type,amount_etb,balance_before_etb,balance_after_etb,reference_id,status,details)
    values('wtx-'||substr(gen_random_uuid()::text,1,16),p_user_id,'gift_code_credit',v_code.amount_etb,
      v_before,v_after,v_redemption_id,'Completed','Gift code '||v_code.code||' redeemed');
  insert into public.notifications(id,user_id,title,message,type,is_read)
    values('ntf-'||substr(gen_random_uuid()::text,1,12),p_user_id,'Gift code redeemed',
      'A gift code credit of '||v_code.amount_etb::text||' ETB was added to your wallet.','success',false);
  return jsonb_build_object('ok',true,'code',v_code.code,'amountEtb',v_code.amount_etb,'walletBalanceEtb',v_after);
end;
$$;

create or replace function public.zentro_claim_daily_checkin(p_user_id text,p_reward numeric)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_before numeric;
  v_after numeric;
  v_last_check_in bigint;
  v_now_ms bigint := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_reward numeric := round(coalesce(p_reward,0),2);
  v_id text := 'chk-'||substr(gen_random_uuid()::text,1,16);
begin
  if v_reward<=0 or v_reward>100000 then raise exception 'Daily check-in reward is not enabled'; end if;
  select wallet_balance_etb,last_check_in_at into v_before,v_last_check_in
    from public.users where id=p_user_id and role='customer' and status='Active' for update;
  if not found then raise exception 'Active customer account not found'; end if;
  if v_last_check_in is not null and v_now_ms<v_last_check_in+86400000 then raise exception 'Daily check-in is available once every 24 hours'; end if;
  update public.users set wallet_balance_etb=wallet_balance_etb+v_reward,last_check_in_at=v_now_ms
    where id=p_user_id returning wallet_balance_etb into v_after;
  insert into public.check_in_history(id,user_id,reward_etb,claimed_at) values(v_id,p_user_id,v_reward,clock_timestamp());
  insert into public.wallet_transactions(id,user_id,transaction_type,amount_etb,balance_before_etb,balance_after_etb,reference_id,status,details)
    values('wtx-'||substr(gen_random_uuid()::text,1,16),p_user_id,'checkin_reward',v_reward,v_before,v_after,v_id,'Completed','Daily check-in reward');
  return jsonb_build_object('ok',true,'rewardEtb',v_reward,'lastCheckInAt',v_now_ms,'walletBalanceEtb',v_after);
end;
$$;

create or replace function public.zentro_grant_registration_bonus(p_user_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_bonus numeric;
  v_before numeric;
  v_after numeric;
  v_reference text := 'registration-bonus:'||p_user_id;
begin
  select coalesce(registration_bonus_etb,0) into v_bonus from public.payment_settings where id='default';
  v_bonus := round(coalesce(v_bonus,0),2);
  if v_bonus<=0 then return jsonb_build_object('ok',true,'credited',false,'amountEtb',0); end if;
  select wallet_balance_etb into v_before from public.users where id=p_user_id and role='customer' and status='Active' for update;
  if not found then raise exception 'Active customer account not found'; end if;
  if exists(select 1 from public.wallet_transactions where user_id=p_user_id and transaction_type='registration_bonus' and reference_id=v_reference) then
    return jsonb_build_object('ok',true,'credited',false,'amountEtb',0,'reason','already_granted');
  end if;
  update public.users set wallet_balance_etb=wallet_balance_etb+v_bonus where id=p_user_id returning wallet_balance_etb into v_after;
  insert into public.wallet_transactions(id,user_id,transaction_type,amount_etb,balance_before_etb,balance_after_etb,reference_id,status,details)
    values('wtx-'||substr(gen_random_uuid()::text,1,16),p_user_id,'registration_bonus',v_bonus,v_before,v_after,v_reference,'Completed','One-time registration bonus');
  insert into public.notifications(id,user_id,title,message,type,is_read)
    values('ntf-'||substr(gen_random_uuid()::text,1,12),p_user_id,'Registration bonus',
      'A registration bonus of '||v_bonus::text||' ETB was added to your wallet.','success',false);
  return jsonb_build_object('ok',true,'credited',true,'amountEtb',v_bonus,'walletBalanceEtb',v_after);
end;
$$;

create or replace function public.zentro_apply_verified_deposit_commission(p_user_id text,p_deposit_id text,p_amount numeric)
returns void language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_base text;
  v_rate1 numeric;
  v_rate2 numeric;
  v_rate3 numeric;
  v_rate numeric;
  v_level integer;
  v_invited_by text;
  v_referrer record;
  v_before numeric;
  v_after numeric;
  v_commission numeric;
  v_reference text;
begin
  select commission_base,level1_commission_percent,level2_commission_percent,level3_commission_percent
    into v_base,v_rate1,v_rate2,v_rate3 from public.payment_settings where id='default';
  if coalesce(v_base,'none')<>'verified_deposit' then return; end if;
  select invited_by_code into v_invited_by from public.users where id=p_user_id and role='customer';
  for v_level in 1..3 loop
    exit when v_invited_by is null or v_invited_by='';
    select id,invited_by_code into v_referrer from public.users
      where invitation_code=v_invited_by and role='customer' and status='Active' for update;
    exit when not found;
    v_rate := case v_level when 1 then v_rate1 when 2 then v_rate2 else v_rate3 end;
    v_commission := round(p_amount*greatest(coalesce(v_rate,0),0)/100,2);
    if v_commission>0 then
      v_reference := p_deposit_id||':L'||v_level::text;
      select wallet_balance_etb into v_before from public.users where id=v_referrer.id;
      update public.users set wallet_balance_etb=wallet_balance_etb+v_commission,
        total_commission_etb=total_commission_etb+v_commission where id=v_referrer.id returning wallet_balance_etb into v_after;
      insert into public.wallet_transactions(id,user_id,transaction_type,amount_etb,balance_before_etb,balance_after_etb,reference_id,status,details)
        values('wtx-'||substr(gen_random_uuid()::text,1,16),v_referrer.id,'commission_credit',v_commission,
          v_before,v_after,v_reference,'Completed','Level '||v_level::text||' commission from verified deposit '||p_deposit_id)
        on conflict(user_id,transaction_type,reference_id) do nothing;
      if found then
        insert into public.notifications(id,user_id,title,message,type,is_read)
          values('ntf-'||substr(gen_random_uuid()::text,1,12),v_referrer.id,'Team commission received',
            'Level '||v_level::text||' team commission of '||v_commission::text||' ETB was added to your wallet.','success',false);
      else
        update public.users set wallet_balance_etb=wallet_balance_etb-v_commission,
          total_commission_etb=total_commission_etb-v_commission where id=v_referrer.id;
      end if;
    end if;
    v_invited_by := v_referrer.invited_by_code;
  end loop;
end;
$$;

create or replace function public.zentro_approve_deposit(p_deposit_id text,p_admin text)
returns boolean language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_dep public.deposit_requests%rowtype;
  v_before numeric;
  v_after numeric;
begin
  select * into v_dep from public.deposit_requests where id=p_deposit_id for update;
  if not found or v_dep.status<>'Pending' then raise exception 'Deposit request is not pending'; end if;
  select wallet_balance_etb into v_before from public.users
    where id=v_dep.user_id and role='customer' and status='Active' for update;
  if not found then raise exception 'Active customer account not found'; end if;
  update public.users set wallet_balance_etb=wallet_balance_etb+v_dep.amount_etb,
    total_deposit_etb=total_deposit_etb+v_dep.amount_etb where id=v_dep.user_id returning wallet_balance_etb into v_after;
  update public.deposit_requests set status='Approved',reviewed_by=p_admin,reviewed_at=now() where id=p_deposit_id;
  insert into public.wallet_transactions(id,user_id,transaction_type,amount_etb,balance_before_etb,balance_after_etb,reference_id,status,details)
    values('wtx-'||substr(gen_random_uuid()::text,1,16),v_dep.user_id,'deposit_credit',v_dep.amount_etb,
      v_before,v_after,p_deposit_id,'Completed','Bank deposit verified by Admin');
  perform public.zentro_apply_verified_deposit_commission(v_dep.user_id,p_deposit_id,v_dep.amount_etb);
  insert into public.notifications(id,user_id,title,message,type,is_read)
    values('ntf-'||substr(gen_random_uuid()::text,1,12),v_dep.user_id,'Deposit approved',
      'Your deposit of '||v_dep.amount_etb::text||' ETB was approved and added to your wallet.','success',false);
  insert into public.audit_logs(id,actor,action,target,details)
    values('aud-'||substr(gen_random_uuid()::text,1,12),p_admin,'Deposit approved',p_deposit_id,'Credited '||v_dep.amount_etb::text||' ETB');
  return true;
end;
$$;

revoke all on function public.zentro_redeem_gift_code(text,text) from public,anon,authenticated;
revoke all on function public.zentro_claim_daily_checkin(text,numeric) from public,anon,authenticated;
revoke all on function public.zentro_grant_registration_bonus(text) from public,anon,authenticated;
revoke all on function public.zentro_apply_verified_deposit_commission(text,text,numeric) from public,anon,authenticated;
revoke all on function public.zentro_approve_deposit(text,text) from public,anon,authenticated;
grant execute on function public.zentro_redeem_gift_code(text,text) to service_role;
grant execute on function public.zentro_claim_daily_checkin(text,numeric) to service_role;
grant execute on function public.zentro_grant_registration_bonus(text) to service_role;
grant execute on function public.zentro_apply_verified_deposit_commission(text,text,numeric) to service_role;
grant execute on function public.zentro_approve_deposit(text,text) to service_role;
