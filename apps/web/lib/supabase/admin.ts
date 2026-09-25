import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env } from '../env.ts';
import type { Database } from '../database.types.ts';

/**
 * Service role client, which bypasses RLS. Server code only, and only after its own check: the API routes (a
 * workspace token checked by the database functions), webhooks (a verified signature), notifications after an upload,
 * billing and GitHub linking (an owner checked through the RLS client first), the sign-in limiter, and writes people
 * may not make themselves (Slack webhooks).
 */
export function createAdminClient() {
  return createClient<Database>(env.supabaseUrl(), env.supabaseServiceKey(), { auth: { autoRefreshToken: false, persistSession: false } });
}
