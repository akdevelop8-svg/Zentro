-- Keep money-related operations disabled in this release.
-- API handlers also return HTTP 503 for all wallet mutations and bank-transfer flows.
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
