-- Auto-align is removed: discard every stored per-photo alignment.
--
-- Clears the shift, rotation, scale, left/right flip, estimator version and
-- confidence on every photo, including the few set by hand. Photos then show
-- exactly as their files are laid out, with the halves exchanged only where
-- the album says its camera writes right-eye first (albums.lr_swapped_default,
-- which is kept).
--
-- The columns stay: shipped native bundles still select them, and null is
-- what they already read as "nothing stored". NOT REVERSIBLE - the values are
-- not kept anywhere else.

update public.photos
   set align_dx = null,
       align_dy = null,
       lr_swapped = null,
       align_rotation = null,
       align_scale = null,
       align_version = null,
       align_confidence = null
 where align_dx is not null
    or align_dy is not null
    or lr_swapped is not null
    or align_rotation is not null
    or align_scale is not null
    or align_version is not null
    or align_confidence is not null;

comment on column public.photos.align_dx is 'Unused since auto-align was removed (2026-11-06); always null.';
comment on column public.photos.align_dy is 'Unused since auto-align was removed (2026-11-06); always null.';
comment on column public.photos.lr_swapped is 'Unused since auto-align was removed (2026-11-06); always null. Left/right order comes from albums.lr_swapped_default.';
comment on column public.photos.align_rotation is 'Unused since auto-align was removed (2026-11-06); always null.';
comment on column public.photos.align_scale is 'Unused since auto-align was removed (2026-11-06); always null.';
