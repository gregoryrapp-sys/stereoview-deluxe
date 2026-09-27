import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  downloadSharedFile,
  DropboxError,
  getSharedFileThumbnail,
  isThumbnailUnsupported,
} from "../_shared/dropbox.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";

/**
 * Byte proxy for a single file in a public Dropbox shared folder.
 *
 * This exists only because Dropbox's `?raw=1` shared links do not serve
 * permissive CORS headers (and answer with `application/binary` plus nosniff,
 * which an <img> refuses), so the browser cannot use them directly.
 *
 * Two variants:
 *
 * - original (default): streams the file as-is. The viewer uses this for the
 *   full-resolution stereo pair, on demand.
 * - thumbnail: a Dropbox-rendered downscale of the whole side-by-side image,
 *   cached in Storage under `_cache/dropbox-thumbs/` beside our own photos.
 *   Grids and covers use this. A public page with sixteen Dropbox covers used
 *   to pull sixteen multi-megabyte originals through this function on every
 *   visit, at 5 s or more each; a cached thumbnail is ~60 KB and comes from
 *   the same region as the database.
 */

const PHOTOS_BUCKET = "photos";
const THUMB_CACHE_PREFIX = "_cache/dropbox-thumbs";
/** bestfit: a 2:1 side-by-side lands at 1024x512, the same width as our own thumbnails. */
const THUMB_SIZE = "w1024h768";
/** Cache entries are content-addressed (folder, name, modified time), so they never go stale in place. */
const THUMB_CACHE_CONTROL = "31536000";

async function cacheKey(folderUrl: string, fileName: string, modified: string | undefined): Promise<string> {
  const data = new TextEncoder().encode([folderUrl, fileName, modified ?? "", THUMB_SIZE].join("\n"));
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${THUMB_CACHE_PREFIX}/${hex}.webp`;
}

// The Content-Type is load-bearing: supabase-js only hands the caller a Blob
// for application/octet-stream (or PDF); anything else falls through to
// response.text() and every URL.createObjectURL downstream would throw.
function bytes(body: BodyInit | null, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    headers: { ...corsHeaders, "Content-Type": "application/octet-stream", ...extra },
  });
}

async function thumbnail(folderUrl: string, fileName: string, modified: string | undefined): Promise<Response> {
  const admin = adminClient();
  const key = await cacheKey(folderUrl, fileName, modified);

  const cached = await admin.storage.from(PHOTOS_BUCKET).download(key);
  if (!cached.error && cached.data) {
    return bytes(cached.data, { "X-Thumb-Cache": "hit" });
  }

  let rendered: Response;
  try {
    rendered = await getSharedFileThumbnail(folderUrl, fileName, { format: "webp", size: THUMB_SIZE });
  } catch (err) {
    // Dropbox cannot thumbnail this file (too large, odd type): serve the
    // original rather than nothing. Not cached; it is not a thumbnail.
    if (isThumbnailUnsupported(err)) {
      const original = await downloadSharedFile(folderUrl, fileName);
      return bytes(original.body, { "X-Thumb-Cache": "unsupported" });
    }
    throw err;
  }

  const body = await rendered.arrayBuffer();
  const store = admin.storage
    .from(PHOTOS_BUCKET)
    .upload(key, body, { contentType: "image/webp", cacheControl: THUMB_CACHE_CONTROL, upsert: true })
    .then(({ error }) => {
      if (error) console.warn("dropbox-file: thumbnail cache write failed:", error.message);
    });

  // Answer first, write the cache after, where the runtime allows it.
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(store);
  else await store;

  return bytes(body, { "X-Thumb-Cache": "miss" });
}

async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { folderUrl, fileName, variant, modified } = await req.json();

    if (!folderUrl || !fileName) {
      return new Response(
        JSON.stringify({ error: "folderUrl and fileName are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (variant === "thumbnail") {
      return await thumbnail(folderUrl, fileName, typeof modified === "string" ? modified : undefined);
    }

    // Streamed rather than buffered: the isolate never holds a whole image and
    // the first byte reaches the client sooner.
    const res = await downloadSharedFile(folderUrl, fileName);
    return bytes(res.body);
  } catch (err) {
    const status = err instanceof DropboxError ? err.status : 500;
    console.error("dropbox-file failed:", err instanceof Error ? err.message : err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}

serve(handler);
