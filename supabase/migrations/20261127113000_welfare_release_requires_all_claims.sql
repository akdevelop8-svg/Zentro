-- Require a completed set of daily Welfare claims before releasing the matured vault.
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

  if v_enrollment.claimed_days < v_enrollment.duration_days then
    return jsonb_build_object('ok', false, 'error', 'Complete all daily Welfare claims before releasing the vault');
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

