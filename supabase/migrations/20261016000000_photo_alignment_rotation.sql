-- ---------------------------------------------------------------------------
-- Alignment v2: rotation and scale of the right eye.
--
-- The customer's rig produces pairs whose eyes differ by a fraction of a
-- degree, which a shift cannot correct; v1 detected that and refused to store
-- anything, so no photo from this camera was ever auto-aligned. The estimator
-- now fits rotation and scale about the eye centre (the similarity the
-- customer's Python script fits) and the viewer applies them when it draws
-- the right eye. Non-destructive, like dx/dy: originals are never touched.
--
-- align_version 2 marks results from the new estimator. Background
-- preparation re-measures every photo whose stored version is older
-- (manual alignments, version 0, are left alone).
-- ---------------------------------------------------------------------------

alter table public.photos
  add column if not exists align_rotation real,
  add column if not exists align_scale    real;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'photos_align_transform_range') then
    alter table public.photos
      add constraint photos_align_transform_range check (
        (align_rotation is null or abs(align_rotation) <= 10)
        and (align_scale is null or align_scale between 0.8 and 1.25)
      );
  end if;
end $$;

comment on column public.photos.align_rotation is
  'Right-eye rotation about its centre in degrees, counter-clockwise positive, applied before the dx/dy shift. Null or 0 = none.';
comment on column public.photos.align_scale is
  'Right-eye scale about its centre. Null or 1 = none.';
