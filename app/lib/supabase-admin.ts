import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Service-role client for server-side writes. The anon and authenticated roles
// only get read access (plus a few read-only RPCs), so anything that changes
// game state — packs, cards, stars, achievements, repo cache — goes through
// here. Never import this from client code.
let _admin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!_admin) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    _admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}
