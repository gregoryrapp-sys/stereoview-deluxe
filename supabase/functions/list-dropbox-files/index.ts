import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  type DropboxEntry,
  DropboxError,
  getSharedLinkMetadata,
  isImageEntry,
  listSharedFolder,
} from "../_shared/dropbox.ts";

/**
 * Lists the images in a public Dropbox shared folder, or returns metadata for a
 * single named file.
 *
 * Serves live mode only: the per-file `get_shared_link_metadata` fan-out below
 * exists solely to mint a displayable `src` URL. The import path does not need
 * it - `files/list_folder` already carries id, rev, size and content_hash, and
 * bytes come from `sharing/get_shared_link_file` - so this whole function is
 * deleted once every album is imported.
 */

/** Dropbox rate-limits aggressively; a 500-file folder must not fan out 500-wide. */
const METADATA_CONCURRENCY = 6;

interface DropboxFile {
  name: string;
  path_lower?: string;
  id?: string;
  src: string;
  client_modified?: string;
}

function toDirectLink(url: string): string {
  const urlObj = new URL(url.replace("dl=0", "dl=1"));
  urlObj.searchParams.set("raw", "1");
  return urlObj.toString();
}

function toDropboxFile(meta: DropboxEntry & { url: string }): DropboxFile {
  return {
    name: meta.name,
    path_lower: meta.path_lower,
    id: meta.id,
    src: toDirectLink(meta.url),
    client_modified: meta.client_modified,
  };
}

/**
 * Maps with bounded concurrency, propagating the first failure.
 *
 * The previous implementation was `Promise.all` over an unbounded fan-out whose
 * per-item handler was `res.ok ? res.json() : null`, followed by
 * `.filter(meta => meta !== null)`. A rate-limited file therefore disappeared
 * from the album with no error anywhere - the exact failure mode that would look
 * like "deleted from Dropbox" to a sync. Failing loudly is the whole point here.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { folderUrl, fileName, coverOnly } = await req.json();

    if (!folderUrl) {
      return new Response(JSON.stringify({ error: "folderUrl is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Single-file mode short-circuits the listing entirely. Previously this
    // still paid for a full folder listing just to resolve one cover image,
    // once per photographer on the home page and once per event and album in
    // the cover hooks.
    if (fileName) {
      const meta = await getSharedLinkMetadata(folderUrl, fileName);
      if (!meta?.url) {
        throw new Error(`File "${fileName}" not found in shared folder.`);
      }
      return new Response(JSON.stringify(toDropboxFile(meta)), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const entries = await listSharedFolder(folderUrl);
    const imageFiles = entries.filter(isImageEntry);

    // Cover mode: one listing plus ONE metadata call.
    //
    // Callers that only want a thumbnail used to request the whole folder and
    // keep `photos[0]`, paying a metadata call per file to throw away all but
    // one. Ten uncovered events on a single Gallery render was ten full folder
    // fan-outs, which is what exhausts the Dropbox app quota and makes
    // `files/list_folder` itself start returning 429.
    //
    // Sorted by name so the chosen cover is stable: `list_folder` does not
    // promise an order, so the old `photos[0]` could pick a different photo on
    // each call. A-Z also matches the app's default photo sort.
    if (coverOnly) {
      const first = [...imageFiles].sort((a, b) => a.name.localeCompare(b.name))[0];
      if (!first) {
        return new Response(JSON.stringify(null), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const meta = await getSharedLinkMetadata(folderUrl, first.name);
      return new Response(JSON.stringify(toDropboxFile(meta)), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const files = await mapWithConcurrency(
      imageFiles,
      METADATA_CONCURRENCY,
      async (file) => toDropboxFile(await getSharedLinkMetadata(folderUrl, file.name)),
    );

    return new Response(JSON.stringify(files), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const status = err instanceof DropboxError ? err.status : 500;
    console.error("list-dropbox-files failed:", err instanceof Error ? err.message : err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}

serve(handler);
