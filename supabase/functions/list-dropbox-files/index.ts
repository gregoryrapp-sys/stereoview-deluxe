import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

async function getDropboxToken() {
  try{
    const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: Deno.env.get("DROPBOX_REFRESH_TOKEN")!,
        client_id: Deno.env.get("DROPBOX_APP_KEY")!,
        client_secret: Deno.env.get("DROPBOX_SECRET_KEY")!,
      })
    });
    if (!response.ok) {
        const errorBody = await response.text();
        console.error("Dropbox token refresh failed:", errorBody);
        throw new Error(`Dropbox token refresh failed: ${response.statusText}`);
    }
    const result = await response.json();
    return result.access_token;
  }  catch(err){
    console.error("Error fetching Dropbox token:", err);
    throw err;
  }
}

const DROPBOX_TOKEN = await getDropboxToken();
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

function getDirectLink(url: string): string {
  const urlObj = new URL(url);
  urlObj.searchParams.set('raw', '1');
  return urlObj.toString();
}

async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { folderUrl, fileName } = await req.json();

    if (!folderUrl) {
      return new Response(JSON.stringify({ error: "folderUrl is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!DROPBOX_TOKEN) {
      return new Response(JSON.stringify({ error: "Dropbox token not available" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
/*
    const folderMetaResponse = await fetch('https://api.dropboxapi.com/2/sharing/get_shared_link_metadata', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DROPBOX_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: folderUrl }),
    });

    if (!folderMetaResponse.ok) {
      const errorBody = await folderMetaResponse.text();
      console.error('Dropbox API error (get_shared_link_metadata for folder):', errorBody);
      throw new Error(`Could not get shared folder metadata: ${folderMetaResponse.statusText}`);
    }
    const folderMeta = await folderMetaResponse.json();
    const basePath = folderMeta.path_lower;
    if (folderMeta['.tag'] !== 'folder' || !basePath) {
      throw new Error('The provided URL is not a valid Dropbox folder link.');
    }
*/
    let listResponse = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${DROPBOX_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
            path: "", // An empty path with a shared_link lists the root of the shared folder
            shared_link: { url: folderUrl },
        }),
    });

    if (!listResponse.ok) {
        const errorBody = await listResponse.text();
        console.error("Dropbox API error (list_folder):", errorBody);
        throw new Error(`Dropbox API error: ${listResponse.statusText}`);
    }

     let listData = await listResponse.json();
    let allEntries = listData.entries;

    while (listData.has_more) {
        listResponse = await fetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${DROPBOX_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ cursor: listData.cursor }),
        });
        listData = await listResponse.json();
        allEntries.push(...(listData.entries || []));
    }

    // Dedupe entries by id (handles overlapping pagination windows)
    {
      const seen = new Set<string>();
      allEntries = allEntries.filter((entry: any) => {
        const key = entry.id || entry.path_lower || entry.name;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    const imageFiles = allEntries.filter(entry =>
      entry['.tag'] === 'file' && IMAGE_EXTENSIONS.some(ext => entry.name.toLowerCase().endsWith(ext))
    );

    if (fileName) {
      const fileEntry = imageFiles.find(entry => entry.name === fileName);
      if (!fileEntry) {
        throw new Error(`File "${fileName}" not found in shared folder.`);
      }
      //const relativePath = fileEntry.path_lower.substring(basePath.length);
      const fileMetaResponse = await fetch('https://api.dropboxapi.com/2/sharing/get_shared_link_metadata', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DROPBOX_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: folderUrl, path: "/"+fileName }),
      });

      if (!fileMetaResponse.ok) {
        throw new Error(`Could not get metadata for ${fileName}: ${fileMetaResponse.statusText}`);
      }

      const fileMeta = await fileMetaResponse.json();
      const fileData = {
        name: fileMeta.name,
        path_lower: fileMeta.path_lower,
        id: fileMeta.id,
        src: getDirectLink(fileMeta.url.replace("dl=0", "dl=1") ),
        client_modified: fileMeta.client_modified,
      };

      return new Response(JSON.stringify(fileData), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const metaPromises = imageFiles.map(file => {
      //const relativePath = file.path_lower.substring(basePath.length);
      return fetch('https://api.dropboxapi.com/2/sharing/get_shared_link_metadata', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DROPBOX_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: folderUrl, path: "/"+file.name }),
      })
      .then(res => res.ok ? res.json() : null);
    });

    const metaResults = await Promise.all(metaPromises);

    const dedupedFilesWithSrc = (() => {
      const filtered = metaResults
        .filter(meta => meta !== null)
        .map(meta => ({
          name: meta.name,
          path_lower: meta.path_lower,
          id: meta.id,
          src: getDirectLink(meta.url.replace("dl=0", "dl=1") ),
          client_modified: meta.client_modified,
        }));
      const seen = new Set<string>();
      return filtered.filter((f) => {
        const key = f.id || f.path_lower;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    })();
    const filesWithSrc = dedupedFilesWithSrc;

    return new Response(JSON.stringify(filesWithSrc), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  }catch (err: any) {
    console.error("Error in handler:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

serve(handler);
