# Apple Spatial Photos in StereoView

*A proposal to discuss before anything is built. Written 2026-09-24; feasibility check passed the same day on a synthetic file.*

## What a Spatial Photo is

When an iPhone 15 Pro (or later) or an Apple Vision Pro takes a "spatial" photo, it saves one `.HEIC` file that contains **two full images** — one per eye, shot by two lenses a few centimetres apart — plus depth information. On a Vision Pro it plays back in 3D. Everywhere else (Photos on a Mac, any web browser, StereoView today) only the **first** image is shown; the second eye is inside the file but invisible.

So a spatial photo is, in substance, exactly what StereoView already displays — a left/right pair — just stored in a container the app cannot read yet. That is the whole opportunity: **unpack the pair and treat it like any other side-by-side photo.**

## What it would look like in the app

For you, one new thing and nothing else:

1. **Upload a `.HEIC` spatial photo like any SBS file.** The upload dialog accepts it alongside JPGs.
2. The browser opens the file, pulls out **both** eyes, and places them side by side into a normal SBS JPEG.
3. That JPEG goes through the **same auto-alignment and left/right check** as every other upload, gets its thumbnail, and is stored.
4. **The viewer does not change.** Visitors see the photo the way they see all your others — in 2D on a phone held upright, in stereo turned sideways.

Nothing is sent to a server for conversion; the work happens in your browser during upload, the same way thumbnails and alignment already do. Optionally the original HEIC could be kept alongside the JPEG, in case you ever want it back for a Vision Pro.

## How it works underneath

Browsers cannot decode the video codec (HEVC) inside a spatial photo. A small decoder written for the web (`libheif` compiled to WebAssembly, about 2–3 MB) can. It would load only when a `.HEIC` is picked, never for visitors, and never on pages that don't need it. It reads the file's image list, decodes the two eyes to pixels, and the existing code composes and uploads them.

## Effort and risk

| | |
|---|---|
| Feasibility check | **Done (24 Sep).** A stereo HEIC written with Apple's own image library, laid out the way an iPhone writes it (two full-size images built from 512-pixel tiles, joined by a stereo-pair group), was opened in Chrome with the web decoder. Both eyes came out in under a second for a 4-megapixel pair, and the side-by-side result matched the original. What remains is the same check on photos from your own devices, which you can run yourself (next section). |
| Build | **2–3 days** after a successful check: accept HEIC in the upload dialog, convert, plug into alignment and thumbnails. |
| Ongoing cost | None. No server, no subscription; a one-time ~2–3 MB download for the owner's browser when uploading spatial files. |

**What could go wrong**

- Apple's way of packing two images into HEIF is newer than most decoders. `libheif` reads it on a file built with Apple's own writer; photos straight from your iPhone or Vision Pro are the final confirmation.
- Two 12-megapixel images decoded at once is heavy for a phone browser. Uploading spatial photos from a laptop is safe; from an iPhone it may need to be limited or done one at a time.
- Photos carry an orientation flag that the app currently ignores; spatial photos would be the first case where it matters, so it would be handled as part of this work.
- Vision Pro *videos* are not covered — photos only.

## Check your own photos

A small test page is ready: **https://claude.ai/artifact/DuyeWHDG8c4WnXBTA8GPQ1**

1. In Photos on a Mac, select two or three spatial photos and choose File → Export → **Export Unmodified Original**. (A normal export strips the second eye.)
2. Open the page and drop the files onto it.
3. Each file gets a verdict: **Both eyes decoded**, with the pair shown side by side and the time it took, or **Not a stereo pair**.

The page runs entirely in your browser; the photos are not uploaded anywhere.

## Questions for you

1. Which devices make your spatial photos? Any of them will work: iPhone and Vision Pro write the same kind of file. The answer only tells us how large each eye is, which decides whether uploading from a phone browser needs to be limited.
2. Roughly how many do you have, and how many per event going forward?
3. Should the original HEIC be kept in the app as well, or is the SBS JPEG enough?
4. Any interest in the reverse — turning your existing SBS photos into spatial photos for someone with a Vision Pro? (A separate, later piece of work.)
5. Could you run **two or three real spatial photos** through the check page above, or send them over?

## If the check fails

Photos on a Mac can export a spatial photo as two separate images, and StereoView already accepts left/right pairs in the pair-upload page. That is a manual detour rather than a feature, but it means spatial photos are never *stuck*.
