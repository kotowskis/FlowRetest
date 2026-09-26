/**
 * Test mode (ADR 0019): the app on the local stack with seeded test data, the fake GitHub, Slack and Stripe from
 * scripts/fake-services.mjs and mail in Mailpit, so it runs without any of the accounts production needs.
 * `npm run test-mode` sets FLOWRETEST_TEST_MODE=true. The flag counts only when the app and its database both run on
 * localhost: a server with a public APP_URL or a hosted Supabase ignores it, so it can never open the one-click
 * sign-in below on a real deployment.
 *
 * No server-only import: scripts/test-mode.ts and the seed use the same accounts.
 */
export const TEST_MODE_VAR = 'FLOWRETEST_TEST_MODE';

export function isLocalUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

/** Why FLOWRETEST_TEST_MODE=true is ignored, or undefined when test mode is on (or was never asked for). */
export function testModeProblem(source: Record<string, string | undefined> = process.env): string | undefined {
  if (source[TEST_MODE_VAR] !== 'true') return undefined;
  if (!isLocalUrl(source.APP_URL || 'http://127.0.0.1:3100')) return `APP_URL ${source.APP_URL} is not on localhost`;
  if (!isLocalUrl(source.NEXT_PUBLIC_SUPABASE_URL)) return `NEXT_PUBLIC_SUPABASE_URL ${source.NEXT_PUBLIC_SUPABASE_URL ?? '(unset)'} is not on localhost`;
  return undefined;
}

export function testMode(source: Record<string, string | undefined> = process.env): boolean {
  return source[TEST_MODE_VAR] === 'true' && testModeProblem(source) === undefined;
}

let warned = false;

/** Logs once per server process that the flag is set but ignored, so an operator sees why nothing changed. */
export function warnIfTestModeIgnored(source: Record<string, string | undefined> = process.env): void {
  const problem = testModeProblem(source);
  if (!problem || warned) return;
  warned = true;
  console.warn(`[test-mode] ${TEST_MODE_VAR}=true ignored: ${problem}`);
}

export interface TestAccount {
  email: string;
  /** What this person sees after signing in, for the login page. */
  role: string;
}

/**
 * People of the seeded data (scripts/test-mode-seed.ts). The login page of a server in test mode signs in as any of
 * them without an email; no other address gets that.
 */
export const TEST_ACCOUNTS: readonly TestAccount[] = [
  { email: 'owner@acme-agency.test', role: 'Owner of Acme Agency (Agency plan): two customer workspaces, GitHub, Slack, drift matrix' },
  { email: 'dev@acme-agency.test', role: 'Member of Acme Agency: reads runs, cannot change billing or members' },
  { email: 'new.hire@acme-agency.test', role: 'Invited to Acme Agency; the first sign-in accepts the invitation' },
  { email: 'owner@solo-studio.test', role: 'Owner of Solo Studio (Free plan): one workspace, paid features locked' },
];

export function isTestAccount(email: string): boolean {
  return TEST_ACCOUNTS.some((a) => a.email === email);
}
