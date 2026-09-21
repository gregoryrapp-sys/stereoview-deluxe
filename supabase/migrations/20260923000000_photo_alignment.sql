-- Non-destructive stereo alignment metadata.
--
-- The camera does not produce perfectly aligned pairs, and sometimes writes
-- them right-eye-first. Pixels are never rewritten: the viewer offsets the
-- right eye's source rectangle by (align_dx, align_dy) - in source pixels of
-- one eye, measured AFTER lr_swapped is applied - and crops both eyes to the
-- overlap. Matching content satisfies L(x, y) ~ R(x + dx, y + dy).
--
-- Null = unknown (nothing stored yet). align_version 0 = set by hand in the
-- viewer; >= 1 = written by that version of the estimator.
--
-- lr_swapped null inherits albums.lr_swapped_default: a camera that always
-- writes R-L is an album-wide fact, not a per-photo one.

alter table public.photos
  add column if not exists align_dx         smallint,
  add column if not exists align_dy         smallint,
  add column if not exists lr_swapped       boolean,
  add column if not exists align_version    smallint,
  add column if not exists align_confidence real;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'photos_align_range') then
    alter table public.photos
      add constraint photos_align_range check (
        abs(coalesce(align_dx, 0)) <= 4096
        and abs(coalesce(align_dy, 0)) <= 4096
        and (align_confidence is null or align_confidence between 0 and 1)
      );
  end if;
end $$;

alter table public.albums
  add column if not exists lr_swapped_default boolean not null default false;

comment on column public.photos.align_dx is
  'Right-eye horizontal source-rect shift in px, after lr_swapped. L(x,y) ~ R(x+dx, y+dy). Null = unknown.';
comment on column public.photos.align_dy is
  'Right-eye vertical source-rect shift in px, after lr_swapped. Null = unknown.';
comment on column public.photos.lr_swapped is
  'Pair is stored right-eye-first. Null inherits albums.lr_swapped_default.';
comment on column public.albums.lr_swapped_default is
  'The source camera writes right-eye-first; photos with lr_swapped null inherit this.';
