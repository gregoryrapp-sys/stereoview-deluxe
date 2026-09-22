-- Indexes for the foreign keys every read path filters on.
--
-- Postgres does not index foreign key columns automatically, and none of these
-- had one. That means a sequential scan on `photos` for:
--
--   * every gallery load (`photos ... .in('album_id', albumIds)`)
--   * the albums RLS SELECT policy, which subqueries `albums` per photo row
--   * `can_read_storage_object()`, which joins photos -> albums -> events once
--     per storage object, i.e. once per signed URL
--
-- The cost is proportional to total photos in the table, not to the album being
-- viewed, so it degrades for everyone as any one photographer uploads more. It
-- gets considerably worse once Dropbox albums are imported and start
-- contributing rows.
--
-- The photos index is composite because callers filter on album_id and then
-- order by sort_order, created_at (see fetchGalleryData in galleryService.ts).

create index if not exists photos_album_id_sort_idx
  on public.photos (album_id, sort_order, created_at);

create index if not exists albums_event_id_idx
  on public.albums (event_id);

create index if not exists events_owner_id_idx
  on public.events (owner_id);
