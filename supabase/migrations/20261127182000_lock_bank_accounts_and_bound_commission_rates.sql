-- Customer bank withdrawal details may be entered once and are immutable afterward.
-- Commission rates are bounded at the database layer so the combined allocation never exceeds the deposit.
create or replace function public.zentro_lock_saved_bank_account()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old_has_account boolean;
  v_new_has_account boolean;
begin
  v_old_has_account :=
    nullif(btrim(old.bank_account_name), '') is not null
    or nullif(btrim(old.bank_account_number), '') is not null;

  v_new_has_account :=
    nullif(btrim(new.bank_account_name), '') is not null
    or nullif(btrim(new.bank_account_number), '') is not null;

  if v_old_has_account then
    if new.bank_account_name is distinct from old.bank_account_name
       or new.bank_account_number is distinct from old.bank_account_number
       or new.bank_method is distinct from old.bank_method then
      raise exception 'Bank account details are locked after the first save.'
        using errcode = '23514';
    end if;
  elsif v_new_has_account then
    if length(btrim(coalesce(new.bank_account_name, ''))) < 2
       or coalesce(new.bank_account_number, '') !~ '^[0-9]{8,18}$'
       or length(btrim(coalesce(new.bank_method, ''))) < 2 then
      raise exception 'Complete bank account details are required.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists users_lock_saved_bank_account on public.users;
create trigger users_lock_saved_bank_account
before update of bank_account_name, bank_account_number, bank_method
on public.users
for each row
execute function public.zentro_lock_saved_bank_account();

alter table public.payment_settings
  drop constraint if exists payment_settings_commission_rates_check;
alter table public.payment_settings
  add constraint payment_settings_commission_rates_check
  check (
    level1_commission_percent between 0 and 100
    and level2_commission_percent between 0 and 100
    and level3_commission_percent between 0 and 100
    and level1_commission_percent + level2_commission_percent + level3_commission_percent <= 100
  );
