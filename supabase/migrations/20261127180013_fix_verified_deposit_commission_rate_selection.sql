-- Correct function variable selection for three separate commission rates.
create or replace function public.zentro_apply_verified_deposit_commission(p_user_id text,p_deposit_id text,p_amount numeric)
returns void language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_base text; v_rate1 numeric; v_rate2 numeric; v_rate3 numeric; v_rate numeric;
  v_level integer; v_invited_by text; v_referrer record;
  v_before numeric; v_after numeric; v_commission numeric; v_reference text;
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
