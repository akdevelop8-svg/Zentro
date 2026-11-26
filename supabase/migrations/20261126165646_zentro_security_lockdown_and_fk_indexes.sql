-- Lock direct client access. Private data is accessible only via the server-side Edge Function.
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
do $$
declare t record;
begin
 for t in select tablename from pg_tables where schemaname = 'public' loop
  execute format('alter table public.%I enable row level security', t.tablename);
  execute format('alter table public.%I force row level security', t.tablename);
 end loop;
end $$;
create index if not exists idx_activities_user_created on public.activities(user_id, created_at desc);
create index if not exists idx_check_in_history_user on public.check_in_history(user_id);
create index if not exists idx_deposits_user_created on public.deposit_requests(user_id, created_at desc);
create index if not exists idx_feedback_messages_user on public.feedback_messages(user_id);
create index if not exists idx_notifications_user_created on public.notifications(user_id, created_at desc);
create index if not exists idx_purchased_plans_user on public.purchased_plans(user_id);
create index if not exists idx_welfare_user on public.welfare_enrollments(user_id);
create index if not exists idx_withdrawals_user_created on public.withdrawal_requests(user_id, created_at desc);
