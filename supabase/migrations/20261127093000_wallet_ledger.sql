-- Add a private wallet ledger for bank deposit/withdrawal balance movements.
create table if not exists public.wallet_transactions (
  id text primary key,
  user_id text not null references public.users(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('deposit_credit','withdrawal_reserve','withdrawal_refund')),
  amount_etb numeric(14,2) not null,
  balance_before_etb numeric(14,2) not null,
  balance_after_etb numeric(14,2) not null,
  reference_id text not null,
  status text not null default 'Pending' check (status in ('Pending','Completed','Reversed')),
  details text,
  created_at timestamptz not null default now()
);
create index if not exists idx_wallet_transactions_user_created
  on public.wallet_transactions(user_id, created_at desc);
alter table public.wallet_transactions enable row level security;
alter table public.wallet_transactions force row level security;
revoke all on public.wallet_transactions from anon, authenticated;
grant all on public.wallet_transactions to service_role;

create or replace function public.zentro_request_withdrawal(
  p_user_id text, p_id text, p_amount numeric, p_fee numeric, p_net numeric,
  p_method_id text, p_method_name text, p_account_name text, p_account_number text
) returns numeric language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_balance numeric; v_before numeric; v_status text;
begin
  if p_amount <= 0 or p_fee < 0 or p_net < 0 or p_net > p_amount then raise exception 'Invalid withdrawal amounts'; end if;
  select status, wallet_balance_etb into v_status, v_before
  from public.users where id = p_user_id and role = 'customer' for update;
  if not found or v_status <> 'Active' then raise exception 'Active customer account not found'; end if;
  if v_before < p_amount then raise exception 'Insufficient wallet balance'; end if;
  update public.users set wallet_balance_etb = wallet_balance_etb - p_amount
    where id = p_user_id returning wallet_balance_etb into v_balance;
  insert into public.withdrawal_requests(
    id,user_id,amount_etb,fee_etb,net_amount_etb,payment_method_id,
    payment_method_name,customer_account_name,customer_account_number,status
  ) values (p_id,p_user_id,p_amount,p_fee,p_net,p_method_id,p_method_name,p_account_name,p_account_number,'Pending');
  insert into public.wallet_transactions(id,user_id,transaction_type,amount_etb,balance_before_etb,balance_after_etb,reference_id,status,details)
  values ('wtx-' || substr(gen_random_uuid()::text,1,16),p_user_id,'withdrawal_reserve',-p_amount,v_before,v_balance,p_id,'Pending','Withdrawal amount reserved pending Admin review');
  insert into public.audit_logs(id,actor,action,target,details)
  values ('aud-' || substr(gen_random_uuid()::text,1,12),p_user_id,'Withdrawal requested',p_id,'Amount ' || p_amount::text || ' ETB; wallet funds reserved');
  return v_balance;
end;
$$;

create or replace function public.zentro_approve_deposit(p_deposit_id text, p_admin text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_dep public.deposit_requests%rowtype; v_before numeric; v_after numeric;
begin
  select * into v_dep from public.deposit_requests where id=p_deposit_id for update;
  if not found or v_dep.status <> 'Pending' then raise exception 'Deposit request is not pending'; end if;
  select wallet_balance_etb into v_before from public.users
    where id=v_dep.user_id and role='customer' and status='Active' for update;
  if not found then raise exception 'Active customer account not found'; end if;
  update public.users set wallet_balance_etb=wallet_balance_etb+v_dep.amount_etb,
    total_deposit_etb=total_deposit_etb+v_dep.amount_etb
    where id=v_dep.user_id returning wallet_balance_etb into v_after;
  update public.deposit_requests set status='Approved', reviewed_by=p_admin, reviewed_at=now() where id=p_deposit_id;
  insert into public.wallet_transactions(id,user_id,transaction_type,amount_etb,balance_before_etb,balance_after_etb,reference_id,status,details)
  values ('wtx-' || substr(gen_random_uuid()::text,1,16),v_dep.user_id,'deposit_credit',v_dep.amount_etb,v_before,v_after,p_deposit_id,'Completed','Bank deposit verified by Admin');
  insert into public.notifications(id,user_id,title,message,type,is_read)
  values ('ntf-' || substr(gen_random_uuid()::text,1,12),v_dep.user_id,'Deposit approved',
    'Your deposit of ' || v_dep.amount_etb::text || ' ETB was approved and added to your wallet.','success',false);
  insert into public.audit_logs(id,actor,action,target,details)
  values ('aud-' || substr(gen_random_uuid()::text,1,12),p_admin,'Deposit approved',p_deposit_id,'Credited ' || v_dep.amount_etb::text || ' ETB');
  return true;
end;
$$;

create or replace function public.zentro_process_withdrawal(p_withdrawal_id text, p_admin text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_wd public.withdrawal_requests%rowtype;
begin
  select * into v_wd from public.withdrawal_requests where id=p_withdrawal_id for update;
  if not found or v_wd.status <> 'Approved' then raise exception 'Only approved withdrawals can be marked processed'; end if;
  update public.withdrawal_requests set status='Processed', reviewed_by=p_admin, processed_at=now() where id=p_withdrawal_id;
  update public.users set total_withdraw_etb=total_withdraw_etb+v_wd.amount_etb where id=v_wd.user_id and role='customer';
  update public.wallet_transactions set status='Completed', details='Bank payout confirmed by Admin'
    where reference_id=p_withdrawal_id and transaction_type='withdrawal_reserve' and status='Pending';
  insert into public.notifications(id,user_id,title,message,type,is_read)
  values ('ntf-' || substr(gen_random_uuid()::text,1,12),v_wd.user_id,'Withdrawal processed',
    'Your withdrawal of ' || v_wd.net_amount_etb::text || ' ETB has been marked as paid.','success',false);
  insert into public.audit_logs(id,actor,action,target,details)
  values ('aud-' || substr(gen_random_uuid()::text,1,12),p_admin,'Withdrawal processed',p_withdrawal_id,'Marked paid: ' || v_wd.net_amount_etb::text || ' ETB');
  return true;
end;
$$;

create or replace function public.zentro_reject_withdrawal(p_withdrawal_id text, p_admin text, p_reason text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_wd public.withdrawal_requests%rowtype; v_before numeric; v_after numeric;
begin
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'Rejection reason is required'; end if;
  select * into v_wd from public.withdrawal_requests where id=p_withdrawal_id for update;
  if not found or v_wd.status <> 'Pending' then raise exception 'Only pending withdrawals can be rejected'; end if;
  select wallet_balance_etb into v_before from public.users where id=v_wd.user_id and role='customer' for update;
  if not found then raise exception 'Customer account not found'; end if;
  update public.users set wallet_balance_etb=wallet_balance_etb+v_wd.amount_etb
    where id=v_wd.user_id returning wallet_balance_etb into v_after;
  update public.withdrawal_requests set status='Rejected', rejection_reason=btrim(p_reason), reviewed_by=p_admin where id=p_withdrawal_id;
  insert into public.wallet_transactions(id,user_id,transaction_type,amount_etb,balance_before_etb,balance_after_etb,reference_id,status,details)
  values ('wtx-' || substr(gen_random_uuid()::text,1,16),v_wd.user_id,'withdrawal_refund',v_wd.amount_etb,v_before,v_after,p_withdrawal_id,'Reversed','Pending withdrawal rejected; reserved amount returned');
  update public.wallet_transactions set status='Reversed' where reference_id=p_withdrawal_id and transaction_type='withdrawal_reserve';
  insert into public.notifications(id,user_id,title,message,type,is_read)
  values ('ntf-' || substr(gen_random_uuid()::text,1,12),v_wd.user_id,'Withdrawal rejected',
    'Your withdrawal request was rejected and ' || v_wd.amount_etb::text || ' ETB returned to your wallet. Reason: ' || btrim(p_reason),'warning',false);
  insert into public.audit_logs(id,actor,action,target,details)
  values ('aud-' || substr(gen_random_uuid()::text,1,12),p_admin,'Withdrawal rejected',p_withdrawal_id,btrim(p_reason));
  return true;
end;
$$;

revoke all on function public.zentro_request_withdrawal(text,text,numeric,numeric,numeric,text,text,text,text) from public, anon, authenticated;
revoke all on function public.zentro_approve_deposit(text,text) from public, anon, authenticated;
revoke all on function public.zentro_process_withdrawal(text,text) from public, anon, authenticated;
revoke all on function public.zentro_reject_withdrawal(text,text,text) from public, anon, authenticated;
grant execute on function public.zentro_request_withdrawal(text,text,numeric,numeric,numeric,text,text,text,text) to service_role;
grant execute on function public.zentro_approve_deposit(text,text) to service_role;
grant execute on function public.zentro_process_withdrawal(text,text) to service_role;
grant execute on function public.zentro_reject_withdrawal(text,text,text) to service_role;
