import { createClient, FunctionRegion } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables. Check VITE_SUPABASE_URL and the publishable/anon key.');
}

export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const PHOTOS_BUCKET = 'photos';

/** For requests the client library cannot make with progress events (large video uploads). */
export const SUPABASE_URL: string = supabaseUrl;
export const SUPABASE_KEY: string = supabaseKey;

/**
 * Edge functions run wherever the caller is unless told otherwise, while the
 * database lives in East US. The gallery function alone makes six sequential
 * database round trips, so a visitor in Europe was paying a transatlantic hop
 * for each one. Every invoke passes this so the function runs beside the data.
 */
export const FUNCTIONS_REGION = FunctionRegion.UsEast1;
