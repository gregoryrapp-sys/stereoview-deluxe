import { createClient } from "https://esm.sh/@supabase/supabase-js@2.107.0";

/**
 * Service-role Supabase client for edge functions.
 *
 * Prefers the bare SUPABASE_SERVICE_ROLE_KEY. It is marked deprecated in the
 * dashboard, but it is unambiguous and still injected, whereas
 * SUPABASE_SECRET_KEYS is a JSON dictionary whose shape is not guaranteed.
 * Guessing an entry out of that dictionary is the worse default by far: picking
 * a publishable key instead of a secret one would not raise anything. The client
 * would simply be subject to RLS, every private row would come back invisible,
 * and a correctly entered PIN would report "not found" - a misconfiguration that
 * looks exactly like a broken feature.
 */

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;

  const dict = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!dict) {
    throw new Error(
      "No service credential: set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEYS",
    );
  }

  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(dict);
  } catch {
    return dict.trim(); // Already a bare key.
  }

  const entries = Object.entries(parsed).filter(([, value]) => typeof value === "string" && value);
  const preferred =
    entries.find(([name]) => /secret|service/i.test(name)) ?? entries[0];

  if (!preferred) throw new Error("SUPABASE_SECRET_KEYS contained no usable key");
  return preferred[1];
}

export function adminClient() {
  return createClient(requireEnv("SUPABASE_URL"), serviceKey(), {
    auth: { persistSession: false },
  });
}

export type AdminClient = ReturnType<typeof adminClient>;

/**
 * A client acting as the CALLER, for reads that must go through RLS. Used to
 * prove ownership of a row before any service-role write touches it.
 */
export function userClient(authHeader: string | null) {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authHeader ?? "" } },
    auth: { persistSession: false },
  });
}
