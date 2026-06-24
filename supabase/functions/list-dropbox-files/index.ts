// /supabase/functions/list-dropbox-files/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const DROPBOX_API_TOKEN = Deno.env.get('DROPBOX_ACCESS_TOKEN');

interface DropboxFile {
  '.tag': 'file';
  name: string;
  path_lower: string;
  id: string;
}

// Helper to check if a file is a supported image based on its name
function isSupportedImage(fileName: string): boolean {
  return /\.(jpg|jpeg|png|webp)$/i.test(fileName);
}

// The main function that handles requests
serve(async (req: Request) => {
  // This is needed for CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { folderUrl } = await req.json();
    if (!folderUrl) {
      return new Response(JSON.stringify({ error: 'folderUrl is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!DROPBOX_API_TOKEN) {
      throw new Error('Missing DROPBOX_ACCESS_TOKEN secret in Supabase project.');
    }

    // 1. Get the metadata for the shared link to find the folder path
    const metaRes = await fetch('https://api.dropboxapi.com/2/sharing/get_shared_link_metadata', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DROPBOX_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: folderUrl }),
    });

    if (!metaRes.ok) {
      const errorBody = await metaRes.text();
      console.error('Dropbox get_shared_link_metadata error:', errorBody);
      throw new Error(`Failed to get Dropbox folder metadata. Status: ${metaRes.status}`);
    }

    const metaData = await metaRes.json();
    if (metaData['.tag'] !== 'folder') {
      throw new Error('The shared link is not for a folder.');
    }

    const folderPath = metaData.path_lower;
    if (!folderPath) {
      throw new Error('Could not determine folder path from the shared link.');
    }

    // 2. List all files in the folder recursively
    const listRes = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DROPBOX_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: folderPath,
        recursive: true, // Look inside subfolders as well
        include_media_info: false,
        include_deleted: false,
      }),
    });

    if (!listRes.ok) {
      const errorBody = await listRes.text();
      console.error('Dropbox list_folder error:', errorBody);
      throw new Error(`Failed to list Dropbox folder contents. Status: ${listRes.status}`);
    }

    const listData = await listRes.json();
    const imageFiles = listData.entries.filter(
      (entry: DropboxFile) => entry['.tag'] === 'file' && isSupportedImage(entry.name),
    );

    // 3. Create a batch request to get temporary links for all images
    const batchEntries = imageFiles.map((file: DropboxFile) => ({
      path: file.path_lower,
    }));

    const tempLinkRes = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link_batch', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DROPBOX_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ entries: batchEntries }),
    });

    if (!tempLinkRes.ok) {
      const errorBody = await tempLinkRes.text();
      console.error('Dropbox get_temporary_link_batch error:', errorBody);
      throw new Error(`Failed to get temporary links. Status: ${tempLinkRes.status}`);
    }

    const tempLinkData = await tempLinkRes.json();

    // 4. Format the response for the frontend
    const photoData = tempLinkData.entries.map((entry: any) => {
      if (entry.result && entry.result.link) {
        return {
          url: entry.result.link,
          name: entry.result.metadata.name,
          path: entry.result.metadata.path_display,
        };
      }
      return null;
    }).filter(Boolean);

    return new Response(JSON.stringify(photoData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Edge function error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
