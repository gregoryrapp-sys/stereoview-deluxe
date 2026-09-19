-- Keep public.slugify() in step with makeSlug() in src/services/galleryService.ts.
--
-- Both turned every non-alphanumeric run into a separator, so an apostrophe became
-- a dash: "Ben and Isabel's Wedding" produced ben-and-isabel-s-wedding rather than
-- ben-and-isabels-wedding.
--
-- This has to change on both sides. The set_*_slug triggers
-- (20260615000000_public_slugs_covers_shares.sql:64-126) call slugify() to generate
-- a slug whenever one is submitted blank, so fixing only the client would leave the
-- auto-generated path producing the old form.
--
-- Existing slugs are deliberately left alone: they are public URLs, and rewriting
-- them would break any link already shared.

create or replace function public.slugify(value text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(
    replace(replace(lower(coalesce(value, '')), '''', ''), '’', ''),
    '[^a-z0-9]+', '-', 'g'
  ));
$$;
