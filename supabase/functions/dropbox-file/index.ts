import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { downloadSharedFile, DropboxError } from "../_shared/dropbox.ts";

/**
 * Byte proxy for a single file in a public Dropbox shared folder.
 *
 * This exists only because Dropbox's `?raw=1` shared links do not serve
 * permissive CORS headers, so the browser cannot read them into a canvas. Once
 * albums are imported into Supabase Storage this function has no remaining
 * callers and should be deleted along with the rest of live mode.
 */
async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { folderUrl, fileName } = await req.json();

    if (!folderUrl || !fileName) {
      return new Response(
        JSON.stringify({ error: "folderUrl and fileName are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const res = await downloadSharedFile(folderUrl, fileName);

    // Streamed rather than buffered through `await res.blob()`: the isolate no
    // longer holds a whole image in memory, and the first byte reaches the
    // client sooner.
    //
    // The Content-Type passthrough is load-bearing. supabase-js only hands the
    // caller a Blob when the response is application/octet-stream (or PDF);
    // anything else falls through to response.text() and every
    // URL.createObjectURL call site downstream would throw on a string. Dropbox
    // serves octet-stream, so this works - but it is a coupling, not a choice.
    return new Response(res.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
      },
    });
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
