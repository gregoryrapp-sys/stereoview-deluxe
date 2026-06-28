import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
//import{ getDropboxToken } from "../_shared/getDropboxToken.ts";

//const DROPBOX_TOKEN = Deno.env.get("DROPBOX_ACCESS_TOKEN")!;
const DROPBOX_TOKEN  = await getDropboxToken()!;

async function getDropboxToken() {
  try{
    console.log(`Check the environment variables: DROPBOX_REFRESH_TOKEN=${Deno.env.get("DROPBOX_REFRESH_TOKEN")}, DROPBOX_APP_KEY=${Deno.env.get("DROPBOX_APP_KEY")}, DROPBOX_SECRET_KEY=${Deno.env.get("DROPBOX_SECRET_KEY")}`);
    // 2. Request a new Access Token from Dropbox
    const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: Deno.env.get("DROPBOX_REFRESH_TOKEN")!,
        client_id: Deno.env.get("DROPBOX_APP_KEY"),
        client_secret: Deno.env.get("DROPBOX_SECRET_KEY")
      })
    });
    const result = await response.json();
    console.log("Dropbox token response:", result);
    return result.access_token; // Use this to make your API call

  }  catch(err){
    console.error("Error fetching Dropbox token:", err);
    throw err;
  }

  
}


async function dropboxFetch(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DROPBOX_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();

  if (!res.ok) {
    console.error("DROPBOX API ERROR:", text);
    throw new Error(text);
  }

  return JSON.parse(text);
}



async function handler(req: Request): Promise<Response> {
  console.log("list-dropbox-files DROPBOX_TOKEN:", DROPBOX_TOKEN);
  
  try {
    const { folderUrl } = await req.json();
    console.log("Received folderUrl:", folderUrl);
    if (!folderUrl) {
      return new Response(JSON.stringify({ error: "folderUrl required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine the base URL of your Supabase functions dynamically 
    // e.g., https://<your-project-ref>.supabase.co/functions/v1
    let data = await dropboxFetch(
      "https://api.dropboxapi.com/2/files/list_folder",
      {
        path: "",
        shared_link: { url: folderUrl },
      }
    );
    let unfilteredEntries = data.entries;
    let cursor = data.cursor;
    while (data.has_more) {
      data = await dropboxFetch(
        "https://api.dropboxapi.com/2/files/list_folder/continue",
        { cursor }
      );
      unfilteredEntries.push(...(data.entries || []));
      cursor = data.cursor;
    }
    // Filter for files and images
    const imageEntries = unfilteredEntries.filter((f: any) => f[".tag"] === "file" && /\.(jpg|jpeg|png|webp)$/i.test(f.name));
    console.log(`Found ${imageEntries.length} image files in folder ${folderUrl}`);
    // For each image, get the direct download link. This is for <img> tags.
    const entriesWithLinks = await Promise.all(
      imageEntries.map(async (file: any) => {
        try {
          // This API call gets metadata including a temporary direct link.
          const response = await fetch("https://content.dropboxapi.com/2/sharing/get_shared_link_file", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${DROPBOX_TOKEN}`,
              "Dropbox-API-Arg": JSON.stringify({
                url: folderUrl,
                path: "/"+file.name
              })
            }
          });

          if (!response.ok) {
            console.error(`Error fetching direct link for ${file.name}:`, await response.text());
            return { ...file, src: '' }; // Fallback
          }

          const resultHeader = response.headers.get("dropbox-api-result") || '{}';
          const result = JSON.parse(resultHeader);
          return { ...file, src: result.url.replace("dl=0", "dl=1") };
        } catch (e) {
          console.error(`Error processing file ${file.name}:`, e);
          return { ...file, src: '' }; // Fallback
        }
      })
    );

    return new Response(JSON.stringify(entriesWithLinks), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }catch (err: any) {
    console.error("Error in handler:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return handler(req);
});

