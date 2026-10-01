import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type { SupabaseClient };

/** Server-only client using the service-role key. Never ship this to a browser. */
export function createServiceClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
