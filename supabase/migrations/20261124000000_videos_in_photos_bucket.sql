-- ---------------------------------------------------------------------------
-- Side-by-side videos are stored in the photos bucket like photos.
--
-- The bucket was created for images only, 50 MB per file. The photographer's
-- videos are HEVC MP4s of 130-650 MB (15 Mbit/s, 3840x1080), uploaded as they
-- are with no re-encoding. This allows the video types and raises the
-- per-file limit to 2 GiB (about 18 minutes at that bitrate).
--
-- Written against the live row rather than restating it: production storage
-- settings may have been changed in the dashboard, so existing allowed types
-- are kept, a larger existing limit is never lowered, and a bucket with no
-- type restriction (null) stays unrestricted.
--
-- NOT ENOUGH ON ITS OWN: the project-wide "Upload file size limit"
-- (Dashboard -> Storage -> Settings) caps every bucket and must also be
-- raised to at least the largest video (it defaults to 50 MB).
-- ---------------------------------------------------------------------------
update storage.buckets
   set allowed_mime_types = case
         when allowed_mime_types is null then null
         else (
           select array_agg(distinct t)
             from unnest(allowed_mime_types || array['video/mp4', 'video/quicktime', 'video/x-m4v']) as t
         )
       end,
       file_size_limit = greatest(coalesce(file_size_limit, 0), 2147483648)
 where id = 'photos';
