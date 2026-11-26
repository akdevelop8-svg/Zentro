# ZENTRO Supabase

This project uses PostgreSQL and the `zentro-auth` Edge Function.

## Deploy
Install the Supabase CLI, authenticate it, link project `sbqzjqrotlrqlpyicjof`, then run:

```sh
supabase db push
supabase functions deploy zentro-auth --no-verify-jwt
```

Never commit service-role keys, admin passwords, password hashes, session secrets, or bank credentials.

## Release safety
Registration, login, profile, support, and read-only administrative views are available.
Wallet credits, check-in rewards, plan purchases, deposits, withdrawals, gift codes,
and admin money approvals are disabled with HTTP 503. Payment methods, registration
bonus, check-in, and referral commission settings are zeroed for this release.

RLS is enabled and forced on public tables. anon/authenticated have no direct table
privileges or policies. Only the server-side service_role may access private data.
