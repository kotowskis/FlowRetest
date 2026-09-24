import { loadConfig, loadSecret } from './config.ts';
import { CLI_VERSION } from './index.ts';

/** A refusal from the hosted layer, with its HTTP status. */
export class CloudError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'CloudError';
    this.status = status;
  }
}

/** Hosted layer URL: `--url`, then FLOWRETEST_URL, then `cloud.url` in config.yml. */
export function cloudUrl(cwd: string, explicit?: string): string {
  const url = explicit ?? process.env.FLOWRETEST_URL ?? loadConfig(cwd).cloud?.url;
  if (!url) throw new Error('no hosted layer URL: pass --url, set FLOWRETEST_URL or add `cloud: { url: ... }` to .flowretest/config.yml');
  return url.replace(/\/+$/, '');
}

export function cloudToken(cwd: string): string {
  const token = loadSecret(cwd, 'FLOWRETEST_TOKEN');
  if (!token) throw new Error('no workspace token: set FLOWRETEST_TOKEN (create one on the workspace page of the hosted layer)');
  return token;
}

/** True when both a URL and a token are configured, so optional steps (sync after pull) can run. */
export function cloudConfigured(cwd: string): boolean {
  try {
    cloudUrl(cwd);
    return loadSecret(cwd, 'FLOWRETEST_TOKEN') !== undefined;
  } catch {
    return false;
  }
}

/** One authenticated JSON request to the hosted layer; a non-2xx answer throws CloudError with the server's reason. */
export async function cloudRequest<T>(base: string, token: string, path: string, init: { method?: string; body?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': `flowretest/${CLI_VERSION}` },
      body: init.body,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new Error(`request to ${base} failed`, { cause: e });
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // An HTML error page from a proxy; the status says enough.
  }
  if (!res.ok) {
    const reason = typeof json.error === 'string' ? json.error : text.slice(0, 200);
    const hint = res.status === 401 ? ' (the token is wrong or revoked)' : '';
    throw new CloudError(res.status, `${init.method ?? 'GET'} ${path} refused with ${res.status}${hint}: ${reason}`);
  }
  return json as T;
}
