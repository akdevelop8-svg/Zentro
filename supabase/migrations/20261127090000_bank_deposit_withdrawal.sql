-- ZENTRO bank deposit and withdrawal workflow.
-- Uses atomic Postgres functions for wallet reservation, deposit crediting, refunds, and payout completion.
-- Only the service_role may execute these functions; customer/admin authorization is enforced by zentro-auth.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('zentro-deposits', 'zentro-deposits', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

create or replace function public.zentro_request_withdrawal(
  p_user_id text, p_id text, p_amount numeric, p_fee numeric, p_net numeric,
  p_method_id text, p_method_name text, p_account_name text, p_account_number text
) returns numeric
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_balance numeric; v_status text;
begin
  if p_amount <= 0 or p_fee < 0 or p_net < 0 or p_net > p_amount then
    raise exception 'Invalid withdrawal amounts';
  end if;
  select status, wallet_balance_etb into v_status, v_balance
  from public.users where id = p_user_id and role = 'customer' for update;
  if not found or v_status <> 'Active' then raise exception 'Active customer account not found'; end if;
  if v_balance < p_amount then raise exception 'Insufficient wallet balance'; end if;
  update public.users set wallet_balance_etb = wallet_balance_etb - p_amount
  where id = p_user_id returning wallet_balance_etb into v_balance;
  insert into public.withdrawal_requests(
    id,user_id,amount_etb,fee_etb,net_amount_etb,payment_method_id,
    payment_method_name,customer_account_name,customer_account_number,status
  ) values (p_id,p_user_id,p_amount,p_fee,p_net,p_method_id,p_method_name,p_account_name,p_account_number,'Pending');
  insert into public.audit_logs(id,actor,action,target,details)
  values ('aud-' || substr(gen_random_uuid()::text,1,12),p_user_id,
    'Withdrawal requested',p_id,'Amount ' || p_amount::text || ' ETB; wallet funds reserved');
  return v_balance;
end;
$$;

create or replace function public.zentro_approve_deposit(p_deposit_id text, p_admin text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_dep public.deposit_requests%rowtype;
begin
  select * into v_dep from public.deposit_requests where id=p_deposit_id for update;
  if not found or v_dep.status <> 'Pending' then raise exception 'Deposit request is not pending'; end if;
  perform 1 from public.users where id=v_dep.user_id and role='customer' and status='Active' for update;
  if not found then raise exception 'Active customer account not found'; end if;
  update public.users set wallet_balance_etb=wallet_balance_etb+v_dep.amount_etb,
    total_deposit_etb=total_deposit_etb+v_dep.amount_etb where id=v_dep.user_id;
  update public.deposit_requests set status='Approved', reviewed_by=p_admin, reviewed_at=now() where id=p_deposit_id;
  insert into public.notifications(id,user_id,title,message,type,is_read)
  values ('ntf-' || substr(gen_random_uuid()::text,1,12),v_dep.user_id,'Deposit approved',
    'Your deposit of ' || v_dep.amount_etb::text || ' ETB was approved and added to your wallet.','success',false);
  insert into public.audit_logs(id,actor,action,target,details)
  values ('aud-' || substr(gen_random_uuid()::text,1,12),p_admin,'Deposit approved',p_deposit_id,
    'Credited ' || v_dep.amount_etb::text || ' ETB');
  return true;
end;
$$;

create or replace function public.zentro_reject_deposit(p_deposit_id text, p_admin text, p_reason text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_dep public.deposit_requests%rowtype;
begin
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'Rejection reason is required'; end if;
  select * into v_dep from public.deposit_requests where id=p_deposit_id for update;
  if not found or v_dep.status <> 'Pending' then raise exception 'Deposit request is not pending'; end if;
  update public.deposit_requests set status='Rejected', rejection_reason=btrim(p_reason),
    reviewed_by=p_admin, reviewed_at=now() where id=p_deposit_id;
  insert into public.notifications(id,user_id,title,message,type,is_read)
  values ('ntf-' || substr(gen_random_uuid()::text,1,12),v_dep.user_id,'Deposit rejected',
    'Your deposit request was rejected. Reason: ' || btrim(p_reason),'warning',false);
  insert into public.audit_logs(id,actor,action,target,details)
  values ('aud-' || substr(gen_random_uuid()::text,1,12),p_admin,'Deposit rejected',p_deposit_id,btrim(p_reason));
  return true;
end;
$$;

create or replace function public.zentro_approve_withdrawal(p_withdrawal_id text, p_admin text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_wd public.withdrawal_requests%rowtype;
begin
  select * into v_wd from public.withdrawal_requests where id=p_withdrawal_id for update;
  if not found or v_wd.status <> 'Pending' then raise exception 'Withdrawal request is not pending'; end if;
  update public.withdrawal_requests set status='Approved', reviewed_by=p_admin where id=p_withdrawal_id;
  insert into public.audit_logs(id,actor,action,target,details)
  values ('aud-' || substr(gen_random_uuid()::text,1,12),p_admin,'Withdrawal approved',p_withdrawal_id,
    'Net payout ' || v_wd.net_amount_etb::text || ' ETB; awaiting manual bank payout');
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
  update public.withdrawal_requests set status='Processed', reviewed_by=p_admin, processed_at=now()
    where id=p_withdrawal_id;
  update public.users set total_withdraw_etb=total_withdraw_etb+v_wd.amount_etb
    where id=v_wd.user_id and role='customer';
  insert into public.notifications(id,user_id,title,message,type,is_read)
  values ('ntf-' || substr(gen_random_uuid()::text,1,12),v_wd.user_id,'Withdrawal processed',
    'Your withdrawal of ' || v_wd.net_amount_etb::text || ' ETB has been marked as paid.','success',false);
  insert into public.audit_logs(id,actor,action,target,details)
  values ('aud-' || substr(gen_random_uuid()::text,1,12),p_admin,'Withdrawal processed',p_withdrawal_id,
    'Marked paid: ' || v_wd.net_amount_etb::text || ' ETB');
  return true;
end;
$$;

create or replace function public.zentro_reject_withdrawal(p_withdrawal_id text, p_admin text, p_reason text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_wd public.withdrawal_requests%rowtype;
begin
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'Rejection reason is required'; end if;
  select * into v_wd from public.withdrawal_requests where id=p_withdrawal_id for update;
  if not found or v_wd.status <> 'Pending' then raise exception 'Only pending withdrawals can be rejected'; end if;
  update public.users set wallet_balance_etb=wallet_balance_etb+v_wd.amount_etb
    where id=v_wd.user_id and role='customer';
  update public.withdrawal_requests set status='Rejected', rejection_reason=btrim(p_reason),
    reviewed_by=p_admin where id=p_withdrawal_id;
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
revoke all on function public.zentro_reject_deposit(text,text,text) from public, anon, authenticated;
revoke all on function public.zentro_approve_withdrawal(text,text) from public, anon, authenticated;
revoke all on function public.zentro_process_withdrawal(text,text) from public, anon, authenticated;
revoke all on function public.zentro_reject_withdrawal(text,text,text) from public, anon, authenticated;

grant execute on function public.zentro_request_withdrawal(text,text,numeric,numeric,numeric,text,text,text,text) to service_role;
grant execute on function public.zentro_approve_deposit(text,text) to service_role;
grant execute on function public.zentro_reject_deposit(text,text,text) to service_role;
grant execute on function public.zentro_approve_withdrawal(text,text) to service_role;
grant execute on function public.zentro_process_withdrawal(text,text) to service_role;
grant execute on function public.zentro_reject_withdrawal(text,text,text) to service_role;
