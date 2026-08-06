import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
//import{ getDropboxToken } from "../_shared/getDropboxToken.ts";

//const DROPBOX_TOKEN = Deno.env.get("DROPBOX_ACCESS_TOKEN")!;
const DROPBOX_TOKEN = await getDropboxToken();
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

async function handler(req: Request) {
  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  console.log("list-dropbox-files DROPBOX_TOKEN:", DROPBOX_TOKEN);
  try {
    // Invoked via supabase.functions.invoke, so expect POST with JSON body
    const { folderUrl, fileName } = await req.json();
    console.log("Received folderUrl:", folderUrl);
    console.log("Received fileName:", fileName);
    if (!fileName || !folderUrl) {
      return new Response("folderUrl and fileName are required", { status: 400, headers: corsHeaders });
    }
    console.log(`Fetching file: ${fileName}, folder: ${folderUrl}`);

    const res = await fetch(
      "https://content.dropboxapi.com/2/sharing/get_shared_link_file",
      {
        method: "POST", // Dropbox still requires a POST request
        headers: {
          Authorization: `Bearer ${DROPBOX_TOKEN}`,
          "Dropbox-API-Arg": JSON.stringify({
            url: folderUrl, // The shared link to the folder
            path: "/"+fileName, // The path of the file inside the shared folder (e.g., path_lower)
          }),
        },
      }
    );

    if (!res.ok) {
      throw new Error(await res.text());
    }

    const blob = await res.blob();
    console.log(`File ${fileName} size :`, blob.size); // Ensure the blob is fully read before returning
    return new Response(blob, {
      headers: {
        ...corsHeaders,
        "Content-Type": res.headers.get("Content-Type") || "image/jpeg",
        "Cache-Control": "public, max-age=31536000", // Strongly recommend caching the images
      },
    });
  } catch (err: any) {
    console.error("Error fetching Dropbox file:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

serve(handler);

