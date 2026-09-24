import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.ts';
import type { Database } from '../database.types.ts';

export type Db = SupabaseClient<Database>;

/** Client acting as the signed-in user; every query goes through RLS. */
export async function createClient(): Promise<Db> {
  const store = await cookies();
  return createServerClient<Database>(env.supabaseUrl(), env.supabaseAnonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Components cannot set cookies; proxy.ts refreshes the session on every request.
        }
      },
    },
  });
}
