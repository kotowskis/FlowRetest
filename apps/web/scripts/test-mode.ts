/**
 * Test mode (ADR 0019): the hosted layer on this machine with test data and without any production account. One
 * command starts the local Supabase (Docker), the fake GitHub, Slack and Stripe, and `next dev` with
 * FLOWRETEST_TEST_MODE=true, seeds the test data on the first start and prints where to sign in.
 *
 *   npm run test-mode                      # from the repository root or apps/web
 *   npm run test-mode -- --reset           # wipe the local database and the fake Stripe, seed again
 *   npm run test-mode -- --port 3101 --fake-port 55391
 *
 * The settings go to the child processes as environment variables and win over .env.local, which this script neither
 * reads nor writes; values in .env.local meant for production (Resend, the company details) are blanked. Ctrl+C stops
 * the app and the fakes; Supabase keeps running (`npm run db:stop -w @flowretest/web` stops it).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error plain JS dev script without types
import { ensureKeys, fakeEnv } from './fake-services.mjs';
import { seedTestData } from './test-mode-seed.ts';
import { TEST_ACCOUNTS, TEST_MODE_VAR, testModeProblem } from '../lib/test-mode.ts';

const web = fileURLToPath(new URL('..', import.meta.url));
const repo = join(web, '..', '..');
const stateDir = join(web, '.test-mode');
const windows = process.platform === 'win32';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}
const RESET = process.argv.includes('--reset');
const PORT = Number(arg('port', '3100'));
const FAKE_PORT = Number(arg('fake-port', '55390'));
const APP_URL = `http://127.0.0.1:${PORT}`;
const FAKE_BASE = `http://127.0.0.1:${FAKE_PORT}`;

const say = (line: string) => console.log(`[test-mode] ${line}`);
function fail(message: string, code = 4): never {
  console.error(`[test-mode] ${message}`);
  process.exit(code);
}

/** npm and npx are .cmd files on Windows and need a shell there; the arguments are fixed words of this script. */
function run(command: string, args: string[], cwd: string, quiet = false) {
  const options = { cwd, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' } as const;
  return windows ? spawnSync([command, ...args].join(' '), { ...options, shell: true }) : spawnSync(command, args, options);
}

function portTaken(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });
}

function supabaseStatus(): Record<string, string> | undefined {
  const r = run('npx', ['supabase', 'status', '-o', 'env'], web, true);
  if (r.status !== 0) return undefined;
  const values = Object.fromEntries(r.stdout.split(/\r?\n/).map((line) => /^([A-Z_]+)="?(.*?)"?$/.exec(line)).filter((m) => m !== null).map((m) => [m[1], m[2]]));
  return values.API_URL && values.ANON_KEY && values.SERVICE_ROLE_KEY ? values : undefined;
}

async function waitFor(url: string, seconds: number, child: ChildProcess): Promise<void> {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`the process serving ${url} exited with code ${child.exitCode}`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${url} did not answer within ${seconds} s`);
}

const children: ChildProcess[] = [];
let stopping = false;
function stop(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    // next dev starts workers of its own; on Windows only taskkill /T takes them down with it.
    if (windows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

function start(label: string, args: string[], env: NodeJS.ProcessEnv, inherit: boolean): ChildProcess {
  const child = spawn(process.execPath, args, { cwd: web, env, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
  if (!inherit) {
    child.stdout?.on('data', (d: Buffer) => process.stdout.write(d.toString().replace(/^(?=.)/gm, `[${label}] `)));
    child.stderr?.on('data', (d: Buffer) => process.stderr.write(d.toString().replace(/^(?=.)/gm, `[${label}] `)));
  }
  child.on('exit', (code) => {
    if (stopping) return;
    console.error(`[test-mode] ${label} exited with code ${code}; stopping`);
    stop(1);
  });
  children.push(child);
  return child;
}

// ---------------------------------------------------------------------------------------------------------------

if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) fail('Docker is not running. Start Docker Desktop (or the Docker Engine) and run the command again.');
for (const [port, flag] of [[PORT, '--port'], [FAKE_PORT, '--fake-port']] as const) {
  if (await portTaken(port)) fail(`port ${port} is taken, probably by another dev server or fake. Stop it or pick another port with ${flag}.`);
}

// The app and the seed import the workspace packages from their dist/.
const built = ['core', 'schemas'].every((p) => existsSync(join(repo, 'packages', p, 'dist', 'index.js')));
if (!built) {
  say('building @flowretest/core and @flowretest/schemas');
  if (run('npx', ['turbo', 'build', '--filter=@flowretest/core', '--filter=@flowretest/schemas'], repo).status !== 0) fail('the build failed');
}

let supabase = supabaseStatus();
if (!supabase) {
  say('starting the local Supabase (the first start downloads its images and takes a few minutes)');
  if (run('npm', ['run', 'db:start'], web).status !== 0) fail('supabase start failed');
  supabase = supabaseStatus();
  if (!supabase) fail('Supabase started but `supabase status` shows no keys');
}
if (RESET) {
  say('--reset: recreating the local database and clearing the fake Stripe');
  if (run('npx', ['supabase', 'db', 'reset'], web).status !== 0) fail('supabase db reset failed');
  rmSync(stateDir, { recursive: true, force: true });
}

const keys: { privateKey: string } = ensureKeys();
const fakes: Record<string, string> = fakeEnv(FAKE_PORT, keys.privateKey);
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: supabase.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: supabase.SERVICE_ROLE_KEY,
  APP_URL,
  MAILPIT_URL: supabase.MAILPIT_URL ?? supabase.INBUCKET_URL ?? '',
  ...fakes,
  FAKE_SERVICES_PORT: String(FAKE_PORT),
  FAKE_SERVICES_STATE: join(stateDir, 'fake-stripe.json'),
  [TEST_MODE_VAR]: 'true',
  LEGAL_ALLOW_DRAFT_ACCEPTANCE: 'true',
  // Next takes a variable from the environment over .env.local even when it is empty, so these blank out whatever
  // the file holds for production: no mail to real people, the draft legal texts, the default trial.
  RESEND_API_KEY: '',
  MAIL_FROM: '',
  LEGAL_NAME: '',
  LEGAL_ADDRESS: '',
  LEGAL_COMPANY_ID: '',
  LEGAL_EMAIL: '',
  LEGAL_FINAL: '',
  SALES_EMAIL: '',
  STRIPE_AUTOMATIC_TAX: '',
  STRIPE_TRIAL_DAYS: '',
};
const problem = testModeProblem(env);
if (problem) fail(`test mode would be ignored: ${problem}`);

say(`fake GitHub, Slack and Stripe on ${FAKE_BASE}`);
const fake = start('fake', ['scripts/fake-services.mjs', 'serve'], env, false);
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
say(`next dev on ${APP_URL}`);
const app = start('next', [nextBin, 'dev', '--port', String(PORT)], env, true);

try {
  await waitFor(`${FAKE_BASE}/__calls`, 30, fake);
  // The first request compiles the page; that alone can take half a minute.
  await waitFor(`${APP_URL}/login`, 240, app);
  const result = await seedTestData({
    supabaseUrl: supabase.API_URL as string,
    anonKey: supabase.ANON_KEY as string,
    serviceKey: supabase.SERVICE_ROLE_KEY as string,
    appUrl: APP_URL,
    fakeBase: FAKE_BASE,
    stripeSecretKey: env.STRIPE_SECRET_KEY as string,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET as string,
    slackHosts: env.SLACK_WEBHOOK_HOSTS as string,
    stateDir,
    log: say,
  });
  const lines = [
    '',
    `FlowRetest in test mode: ${APP_URL}/login`,
    result.seeded ? 'Test data seeded.' : 'Test data from an earlier start (--reset seeds it again).',
    '',
    'Sign in with one click on the login page as:',
    ...TEST_ACCOUNTS.map((a) => `  ${a.email.padEnd(28)} ${a.role}`),
    '',
    `Mail (sign-in codes, run notifications): ${env.MAILPIT_URL || 'not available'}`,
    `Fake Stripe state: ${FAKE_BASE}/__stripe · calls to the fakes: ${FAKE_BASE}/__calls`,
  ];
  if (result.tokens.length > 0) {
    lines.push('', 'Workspace tokens for `flowretest upload --url ' + APP_URL + '` (FLOWRETEST_TOKEN):');
    for (const t of result.tokens) lines.push(`  ${`${t.organization} / ${t.workspace}`.padEnd(30)} ${t.token}`);
  }
  lines.push('', 'Ctrl+C stops the app and the fakes; Supabase keeps running (npm run db:stop -w @flowretest/web).', '');
  console.log(lines.join('\n'));
} catch (e) {
  console.error(`[test-mode] ${e instanceof Error ? e.message : String(e)}`);
  stop(1);
}
