-- Server-side PIN unlock grants.
--
-- The first implementation minted a JWT carrying an `unlocked_ids` claim, which is
-- what verify_private_access() reads. That cannot work on this project: it uses
-- asymmetric JWT signing keys (SUPABASE_JWKS is present, and the legacy anon and
-- service_role keys are deprecated), so there is no shared secret to sign with and
-- Supabase holds the private key. A self-signed HS256 token would be rejected by
-- both PostgREST and storage-api.
--
-- Instead a grant is an opaque random token stored here, and the unlock-access
-- edge function serves the unlocked gallery itself using the service role -
-- including signing the photo URLs, which is the part a header- or cookie-based
-- scheme could never do, since storage RLS only ever sees the bearer token.
--
-- The trade-off is explicit: access control for unlocked content lives in that
-- function rather than in RLS. verify_private_access() stays in place for now but
-- has no caller.

create table if not exists public.access_grants (
  token       text primary key,
  object_type text not null check (object_type in ('profile', 'event', 'album')),
  object_id   uuid not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists access_grants_expires_at_idx
  on public.access_grants (expires_at);

create index if not exists access_grants_object_idx
  on public.access_grants (object_type, object_id);

-- RLS on with no policies at all: the table is unreadable and unwritable to anon
-- and authenticated alike. Only the service role in the edge function touches it.
alter table public.access_grants enable row level security;

-- Expired grants are cleared opportunistically by the function; this is the
-- backstop if that ever stops happening.
comment on table public.access_grants is
  'Opaque PIN unlock grants. Service-role only; see supabase/functions/unlock-access.';
