-- Private media storage and server-managed authentication safeguards.
create table if not exists public.auth_sessions (
  id text primary key,
  user_id text not null,
  role text not null check (role in ('customer', 'admin')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists auth_sessions_user_active_idx on public.auth_sessions (user_id, expires_at desc) where revoked_at is null;
create table if not exists public.auth_attempts (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('login', 'register')),
  identifier_hash text not null,
  ip_hash text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists auth_attempts_identifier_window_idx on public.auth_attempts (action, identifier_hash, attempted_at desc);
create index if not exists auth_attempts_ip_window_idx on public.auth_attempts (action, ip_hash, attempted_at desc);
alter table public.auth_sessions enable row level security;
alter table public.auth_sessions force row level security;
alter table public.auth_attempts enable row level security;
alter table public.auth_attempts force row level security;
revoke all on public.auth_sessions from anon, authenticated;
revoke all on public.auth_attempts from anon, authenticated;
grant all on public.auth_sessions to service_role;
grant all on public.auth_attempts to service_role;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('zentro-broadcasts', 'zentro-broadcasts', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
