-- Store the source file's modification date for uploaded photos.
-- When null (e.g. pre-existing rows, or remote-URL sources), callers fall back to created_at.
alter table public.photos
  add column file_modified_at timestamptz;