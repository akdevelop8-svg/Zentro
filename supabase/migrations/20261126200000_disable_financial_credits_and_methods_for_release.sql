-- Do not issue sign-up rewards, check-in credits or referral commissions in this release.
update public.payment_settings
set deposit_methods_json = '[]'::jsonb,
    withdrawal_methods_json = '[]'::jsonb,
    registration_bonus_etb = 0,
    daily_check_in_etb = 0,
    level1_commission_percent = 0,
    level2_commission_percent = 0,
    level3_commission_percent = 0,
    updated_at = now()
where id = 'default';
