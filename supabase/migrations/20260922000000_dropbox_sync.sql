-- Dropbox import + re-sync: schema.
--
-- Dropbox albums stop being streamed live at view time and are imported into
-- Storage like any upload, then re-synced against the source folder on demand.
--
-- Keep `source_type` as it is and add `import_state` beside it. Shipped native
-- (Capacitor) bundles are frozen and have no live-update channel; they only
-- know `source_type`, which never changes, so they keep streaming live and keep
-- working. It also makes rollback of a bad import one UPDATE, and leaves the
-- 20+ existing `source_type === 'dropbox'` branches compiling untouched.
--
-- Deletions found by a sync are SOFT (deleted_at). Storage objects are never
-- removed by a sync; readers filter `deleted_at is null`; restore is one UPDATE.
--
-- Everything idempotent.

-- ---------------------------------------------------------------------------
-- albums
-- ---------------------------------------------------------------------------
alter table public.albums
  add column if not exists import_state text not null default 'live';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'albums_import_state_check') then
    alter table public.albums
      add constraint albums_import_state_check
      check (import_state in ('live', 'importing', 'imported', 'failed'));
  end if;
end $$;

alter table public.albums
  add column if not exists dropbox_last_synced_at timestamptz,
  add column if not exists dropbox_last_sync_error text;

comment on column public.albums.import_state is
  'live = stream from Dropbox at view time (legacy); imported = serve from Storage. Read-surface code uses isLiveDropboxAlbum(); source_type alone decides nothing.';

-- ---------------------------------------------------------------------------
-- photos
-- ---------------------------------------------------------------------------
alter table public.photos
  add column if not exists dropbox_file_id      text,
  add column if not exists dropbox_name         text,
  add column if not exists dropbox_rev          text,
  add column if not exists dropbox_content_hash text,
  add column if not exists dropbox_size         bigint,
  add column if not exists source_synced_at     timestamptz,
  add column if not exists deleted_at           timestamptz;

-- Identity for the sync diff. dropbox_file_id is stable across rename and move;
-- name is display metadata; content_hash / rev are CHANGE detectors only, never
-- identity (two identical shots would collide).
create unique index if not exists photos_album_dropbox_file_id_key
  on public.photos (album_id, dropbox_file_id)
  where dropbox_file_id is not null;

-- The common read: live photos of an album.
create index if not exists photos_album_live_idx
  on public.photos (album_id)
  where deleted_at is null;

comment on column public.photos.deleted_at is
  'Soft delete set by a Dropbox sync when the file is gone from the source folder. Objects stay in Storage; readers filter this null. Manual uploads (dropbox_file_id null) are never deleted by sync.';

-- ---------------------------------------------------------------------------
-- sync_runs: one persisted plan per sync, executed in resumable chunks.
--
-- What the owner approved in the preview is exactly what `apply` executes -
-- the plan is stored, not recomputed. The partial unique index below keeps two
-- tabs from running the same album at once.
--
-- No INSERT/UPDATE/DELETE policies: only the dropbox-sync edge function writes
-- here, with the service role, after proving album ownership through RLS with
-- the caller's own JWT.
-- ---------------------------------------------------------------------------
create table if not exists public.sync_runs (
  id               uuid primary key default gen_random_uuid(),
  album_id         uuid not null references public.albums(id) on delete cascade,
  status           text not null
                   check (status in ('planned', 'applying', 'verifying', 'imported', 'failed', 'cancelled')),
  listing_complete boolean not null,
  plan             jsonb not null,
  cursor           integer not null default 0,
  total_items      integer not null,
  applied          jsonb not null default '{"added":0,"updated":0,"renamed":0,"restored":0,"deleted":0,"thumbsMissing":0}'::jsonb,
  errors           jsonb not null default '[]'::jsonb,
  confirmed_at     timestamptz,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  finished_at      timestamptz
);

create unique index if not exists sync_runs_one_active_per_album
  on public.sync_runs (album_id)
  where status in ('planned', 'applying', 'verifying');

create index if not exists sync_runs_album_created_idx
  on public.sync_runs (album_id, created_at desc);

alter table public.sync_runs enable row level security;

drop policy if exists "Album owners can read their sync runs" on public.sync_runs;
create policy "Album owners can read their sync runs"
  on public.sync_runs for select
  using (
    exists (
      select 1 from public.albums a
       where a.id = sync_runs.album_id
         and public.can_access_event(a.event_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Storage usage, for the pre-flight quota check. The storage schema is not
-- reachable through PostgREST, so this is the one sanctioned way to read it.
-- ---------------------------------------------------------------------------
create or replace function public.photos_bucket_usage_bytes()
returns bigint
language sql
stable
security definer
set search_path = public, storage
as $$
  select coalesce(sum((metadata->>'size')::bigint), 0)
    from storage.objects
   where bucket_id = 'photos';
$$;

revoke all on function public.photos_bucket_usage_bytes() from public, anon;
grant execute on function public.photos_bucket_usage_bytes() to authenticated, service_role;
