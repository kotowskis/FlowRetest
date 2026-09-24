/**
 * GitHub App client: a JWT for the app, installation tokens, check runs, the OAuth code exchange that proves a person
 * may use an installation, signed state for the install round trip and webhook signatures. Plain fetch and node:crypto;
 * the base URLs are configurable so tests and local development run against scripts/fake-services.mjs.
 */
import { createHmac, createSign, timingSafeEqual } from 'node:crypto';

export interface GitHubConfig {
  appId: string;
  slug: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  apiUrl: string;
  webUrl: string;
}

/**
 * Base URLs use GITHUB_APP_* names: GitHub Actions sets GITHUB_API_URL on every runner, and process variables win over
 * .env files, so that name would silently point a test or a self-hosted runner at the real API.
 */
export interface GitHubEnv {
  GITHUB_APP_ID?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
  GITHUB_APP_WEBHOOK_SECRET?: string;
  GITHUB_APP_API_URL?: string;
  GITHUB_APP_WEB_URL?: string;
}

/** The app's settings, or undefined when this server has no GitHub App (the workspace page says so). */
export function githubConfig(env: GitHubEnv = process.env as GitHubEnv): GitHubConfig | undefined {
  const { GITHUB_APP_ID: appId, GITHUB_APP_SLUG: slug, GITHUB_APP_PRIVATE_KEY: key, GITHUB_APP_CLIENT_ID: clientId, GITHUB_APP_CLIENT_SECRET: clientSecret, GITHUB_APP_WEBHOOK_SECRET: webhookSecret } = env;
  if (!appId || !slug || !key || !clientId || !clientSecret || !webhookSecret) return undefined;
  return {
    appId,
    slug,
    // Hosting dashboards keep a PEM on one line with literal \n.
    privateKey: key.includes('\\n') ? key.replace(/\\n/g, '\n') : key,
    clientId,
    clientSecret,
    webhookSecret,
    apiUrl: (env.GITHUB_APP_API_URL || 'https://api.github.com').replace(/\/+$/, ''),
    webUrl: (env.GITHUB_APP_WEB_URL || 'https://github.com').replace(/\/+$/, ''),
  };
}

const b64 = (data: string | Buffer) => Buffer.from(data).toString('base64url');

/** RS256 JWT the app authenticates with; valid 9 minutes, backdated 60 s for clock drift (GitHub allows at most 10). */
export function appJwt(config: Pick<GitHubConfig, 'appId' | 'privateKey'>, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: config.appId }));
  const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(config.privateKey);
  return `${head}.${body}.${b64(signature)}`;
}

export class GitHubError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

async function call<T>(url: string, init: { method?: string; auth?: string; body?: unknown; accept?: string }): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      accept: init.accept ?? 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'flowretest-web',
      ...(init.auth ? { authorization: init.auth } : {}),
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) throw new GitHubError(res.status, `GitHub ${init.method ?? 'GET'} ${new URL(url).pathname} failed with ${res.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export async function installationToken(config: GitHubConfig, installationId: number): Promise<string> {
  const json = await call<{ token: string }>(`${config.apiUrl}/app/installations/${installationId}/access_tokens`, { method: 'POST', auth: `Bearer ${appJwt(config)}` });
  return json.token;
}

export interface CheckRunInput {
  repository: string;
  sha: string;
  name: string;
  conclusion: 'success' | 'failure' | 'action_required' | 'neutral';
  detailsUrl: string;
  externalId: string;
  title: string;
  summary: string;
}

export async function createCheckRun(config: GitHubConfig, installationId: number, input: CheckRunInput): Promise<{ id: number; html_url: string }> {
  const token = await installationToken(config, installationId);
  return call<{ id: number; html_url: string }>(`${config.apiUrl}/repos/${input.repository}/check-runs`, {
    method: 'POST',
    auth: `Bearer ${token}`,
    body: {
      name: input.name,
      head_sha: input.sha,
      status: 'completed',
      conclusion: input.conclusion,
      completed_at: new Date().toISOString(),
      details_url: input.detailsUrl,
      external_id: input.externalId,
      output: { title: input.title, summary: input.summary },
    },
  });
}

/** Exchanges the code GitHub adds to the setup or OAuth callback for a user token. */
export async function exchangeCode(config: GitHubConfig, code: string): Promise<string> {
  const json = await call<{ access_token?: string; error?: string; error_description?: string }>(`${config.webUrl}/login/oauth/access_token`, {
    method: 'POST',
    accept: 'application/json',
    body: { client_id: config.clientId, client_secret: config.clientSecret, code },
  });
  if (!json.access_token) throw new GitHubError(400, `GitHub refused the code: ${json.error_description ?? json.error ?? 'no token'}`);
  return json.access_token;
}

export interface InstallationInfo {
  id: number;
  account: { login: string; type: string };
}

/** Installations of this app the person can access; the only proof that a callback's installation_id is theirs. */
export async function userInstallations(config: GitHubConfig, userToken: string): Promise<InstallationInfo[]> {
  const out: InstallationInfo[] = [];
  for (let page = 1; page <= 10; page++) {
    const json = await call<{ installations: InstallationInfo[] }>(`${config.apiUrl}/user/installations?per_page=100&page=${page}`, { auth: `Bearer ${userToken}` });
    out.push(...json.installations);
    if (json.installations.length < 100) break;
  }
  return out;
}

export function installUrl(config: GitHubConfig, state: string): string {
  return `${config.webUrl}/apps/${encodeURIComponent(config.slug)}/installations/new?state=${encodeURIComponent(state)}`;
}

export function authorizeUrl(config: GitHubConfig, state: string, redirectUri: string): string {
  return `${config.webUrl}/login/oauth/authorize?client_id=${encodeURIComponent(config.clientId)}&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
}

export interface InstallState {
  /** workspace */
  w: string;
  /** user who started the linking; the callback must come from the same session */
  u: string;
  /** installation id carried through an extra OAuth round trip */
  i?: number;
  /** expiry, epoch seconds */
  e: number;
}

export function signState(secret: string, state: InstallState): string {
  const body = b64(JSON.stringify(state));
  return `${body}.${b64(createHmac('sha256', secret).update(body).digest())}`;
}

/** The state if the signature matches and it has not expired; undefined otherwise. */
export function verifyState(secret: string, token: string | null, nowSeconds = Math.floor(Date.now() / 1000)): InstallState | undefined {
  const [body, sig] = (token ?? '').split('.');
  if (!body || !sig) return undefined;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  try {
    const state = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as InstallState;
    return typeof state.e === 'number' && state.e > nowSeconds ? state : undefined;
  } catch {
    return undefined;
  }
}

/** X-Hub-Signature-256 of a webhook delivery. */
export function verifyWebhookSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * DIFF asks for a review, so it is `action_required`: a required check blocks the merge until someone accepts or fixes
 * the change. ERROR and BLOCKED fail, because the workflow was not tested.
 */
export function checkConclusion(status: string): CheckRunInput['conclusion'] {
  if (status === 'PASS') return 'success';
  if (status === 'DIFF') return 'action_required';
  return 'failure';
}

/** GitHub caps check output at 65535 characters. */
export function checkSummary(markdown: string, runUrl: string, limit = 65_000): string {
  const tail = `\n\n[Open the plan in FlowRetest](${runUrl})`;
  if (markdown.length + tail.length <= limit) return markdown + tail;
  return `${markdown.slice(0, limit - tail.length - 40)}\n\n… (plan cut, see the full plan)${tail}`;
}
