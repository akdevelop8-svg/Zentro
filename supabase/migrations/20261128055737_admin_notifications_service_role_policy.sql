create policy admin_notifications_service_role_only
on public.admin_notifications
for all
to service_role
using (true)
with check (true);
