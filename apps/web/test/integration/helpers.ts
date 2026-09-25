/**
 * Shared setup of the integration tests: the local Supabase from `npm run db:start` (keys from .env.local or the
 * environment) and, for the API tests, the app on APP_URL (`npm run dev`). Tests skip when either is missing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '../../lib/database.types.ts';

const envFile = new URL('../../.env.local', import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m && !process.env[m[1] as string]) process.env[m[1] as string] = m[2];
  }
}

export const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
export const appUrl = (process.env.APP_URL ?? 'http://127.0.0.1:3100').replace(/\/+$/, '');

async function reachable(target: string): Promise<boolean> {
  try {
    await fetch(target, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/** Reason to skip, or undefined when the local Supabase answers. */
export async function supabaseMissing(): Promise<string | undefined> {
  if (!url || !anonKey || !serviceKey) return 'no Supabase keys (npm run db:start, then .env.local)';
  return (await reachable(`${url}/auth/v1/health`)) ? undefined : `Supabase not reachable at ${url}`;
}

export async function appMissing(): Promise<string | undefined> {
  return (await reachable(`${appUrl}/login`)) ? undefined : `app not reachable at ${appUrl} (npm run dev)`;
}

export type Db = SupabaseClient<Database>;

export function admin(): Db {
  return createClient<Database>(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function anon(): Db {
  return createClient<Database>(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * Puts an organization on a plan as if Stripe had confirmed a subscription (billing tests go through the webhook
 * instead). Tests that need more than the Free plan's single workspace or its integrations call this.
 */
export async function setPlan(orgId: string, plan: 'team' | 'agency', status = 'active'): Promise<void> {
  const row = { organization_id: orgId, stripe_customer_id: `cus_test_${orgId}`, stripe_subscription_id: `sub_test_${orgId}`, plan, status, billing_interval: 'month', ended_at: null };
  const { error } = await admin().from('billing_accounts').upsert(row);
  if (error) throw error;
}

/** A stored run as a row to insert again: without its id and the columns the database generates from the report. */
export function insertableRun(run: Database['public']['Tables']['runs']['Row']): Database['public']['Tables']['runs']['Insert'] {
  const { id: _id, git_repository: _r, git_sha: _s, pull_request: _p, engine_from: _f, engine_to: _t, ...row } = run;
  return row;
}

/** The token hash of a fresh sign-in link, as in the sign-in email; the database refuses password sessions. */
async function signInLink(email: string): Promise<string> {
  const link = await admin().auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) throw link.error;
  return link.data.properties.hashed_token;
}

/** A confirmed user signed in through the emailed link, as people do. */
export async function user(label: string): Promise<{ db: Db; id: string; email: string; cookie: string }> {
  const email = `${label}-${randomUUID().slice(0, 8)}@it.flowretest.test`;
  const created = await admin().auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error('createUser failed');
  const db = anon();
  const signed = await db.auth.verifyOtp({ token_hash: await signInLink(email), type: 'email' });
  if (signed.error) throw signed.error;
  return { db, id: created.data.user.id, email, cookie: await sessionCookie(email) };
}

/** The Cookie header a browser would send after signing in, written by @supabase/ssr itself. */
async function sessionCookie(email: string): Promise<string> {
  const jar = new Map<string, string>();
  const ssr = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const signed = await ssr.auth.verifyOtp({ token_hash: await signInLink(email), type: 'email' });
  if (signed.error) throw signed.error;
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}
