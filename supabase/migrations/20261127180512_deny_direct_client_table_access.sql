-- Add a restrictive deny-all policy for anon/authenticated on every RLS-protected public table.
-- The Edge Function uses service_role; these client roles have no direct table privileges.
do $$
declare
  v_table record;
begin
  for v_table in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity
  loop
    if not exists (
      select 1 from pg_policies p
      where p.schemaname=v_table.schema_name
        and p.tablename=v_table.table_name
        and p.policyname='deny_direct_client_access'
    ) then
      execute format(
        'create policy deny_direct_client_access on %I.%I as restrictive for all to anon, authenticated using (false) with check (false)',
        v_table.schema_name,v_table.table_name
      );
    end if;
  end loop;
end $$;
