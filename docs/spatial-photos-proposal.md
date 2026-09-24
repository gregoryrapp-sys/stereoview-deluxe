# Apple Spatial Photos in StereoView

*A proposal to discuss before anything is built. Written 2026-09-24.*

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
| Feasibility check | **1 day** — decode one real spatial photo from your device in the browser and confirm both eyes come out correctly oriented. This is the step that proves or disproves the approach. |
| Build | **2–3 days** after a successful check: accept HEIC in the upload dialog, convert, plug into alignment and thumbnails. |
| Ongoing cost | None. No server, no subscription; a one-time ~2–3 MB download for the owner's browser when uploading spatial files. |

**What could go wrong**

- Apple's way of packing two images into HEIF is newer than most decoders; the check exists to confirm `libheif` reads it (it is expected to, but has to be shown).
- Two 12-megapixel images decoded at once is heavy for a phone browser. Uploading spatial photos from a laptop is safe; from an iPhone it may need to be limited or done one at a time.
- Photos carry an orientation flag that the app currently ignores; spatial photos would be the first case where it matters, so it would be handled as part of this work.
- Vision Pro *videos* are not covered — photos only.

## Questions for you

1. Which device makes your spatial photos — iPhone (which model) or Vision Pro?
2. Roughly how many do you have, and how many per event going forward?
3. Should the original HEIC be kept in the app as well, or is the SBS JPEG enough?
4. Any interest in the reverse — turning your existing SBS photos into spatial photos for someone with a Vision Pro? (A separate, later piece of work.)
5. Could you send **two or three real spatial photos** for the feasibility check?

## If the check fails

Photos on a Mac can export a spatial photo as two separate images, and StereoView already accepts left/right pairs in the pair-upload page. That is a manual detour rather than a feature, but it means spatial photos are never *stuck*.
