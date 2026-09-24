import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env } from '../env.ts';
import type { Database } from '../database.types.ts';

/**
 * Service role client. Used only by POST /api/runs to call ingest_run(), which checks the token itself;
 * nothing else in the app bypasses RLS.
 */
export function createAdminClient() {
  return createClient<Database>(env.supabaseUrl(), env.supabaseServiceKey(), { auth: { autoRefreshToken: false, persistSession: false } });
}
