import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.107.0";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * Hashes an album/event/profile PIN on behalf of its owner.
 *
 * This function used to expose a `verify` branch that compared an arbitrary
 * password against an arbitrary hash, with no authentication at all. Combined
 * with RLS that makes `albums.password` world-readable on public rows, and PINs
 * that are only 4-6 digits, that was a remote brute-force oracle: read the hash
 * off a public row, then grind 10k-1M candidates through this endpoint.
 *
 * The branch is gone rather than gated. Nothing called it - `verifyPassword` in
 * galleryService had zero callers - and verification belongs inside the unlock
 * flow, which compares server-side and returns a scoped grant rather than a
 * boolean an attacker can iterate on.
 *
 * Hashing still requires a real signed-in user: the anon key is itself a valid
 * JWT, so platform-level verify_jwt does not distinguish a visitor from an
 * account holder. Only an explicit getUser() check does.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return json({ error: "Authentication required." }, 401);
    }

    const { type, password } = await req.json();

    if (type !== "hash") {
      return json({ error: 'Invalid "type" specified. Use "hash".' }, 400);
    }
    if (!password || typeof password !== "string") {
      return json({ error: 'A non-empty "password" string is required.' }, 400);
    }

    return json({ hash: await bcrypt.hash(password) }, 200);
  } catch (error) {
    console.error("password-service failed:", error instanceof Error ? error.message : error);
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
});
