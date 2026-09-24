import { randomBytes } from 'node:crypto';

export interface N8nEnvOptions {
  proxyHost: string;
  proxyPort: number;
  timezone: string;
  encryptionKey?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  executionTimeoutSeconds?: number;
  /** Extra variables from config.yml `engine.env`; they never override the sandbox ones. */
  extra?: Record<string, string>;
}

export const N8N_LOG_FILE = '/home/node/.n8n/logs/n8n.log';

/**
 * Environment of every n8n process in the sandbox. The sandbox never receives a
 * copy of the production environment; only what is listed here plus explicit
 * extras from the config file.
 */
export function buildN8nEnv(options: N8nEnvOptions): Record<string, string> {
  const proxy = `http://${options.proxyHost}:${options.proxyPort}`;
  const sandbox: Record<string, string> = {
    N8N_ENCRYPTION_KEY: options.encryptionKey ?? randomBytes(24).toString('hex'),
    DB_TYPE: 'sqlite',
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    NO_PROXY: '127.0.0.1,localhost',
    N8N_LOG_OUTPUT: 'file',
    N8N_LOG_FILE_LOCATION: N8N_LOG_FILE,
    N8N_LOG_LEVEL: options.logLevel ?? 'info',
    N8N_DIAGNOSTICS_ENABLED: 'false',
    N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
    N8N_TEMPLATES_ENABLED: 'false',
    N8N_ONBOARDING_FLOW_DISABLED: 'true',
    N8N_HIRING_BANNER_ENABLED: 'false',
    N8N_PERSONALIZATION_ENABLED: 'false',
    N8N_PUBLIC_API_DISABLED: 'true',
    N8N_COMMUNITY_PACKAGES_ENABLED: 'false',
    N8N_LICENSE_AUTO_RENEW_ENABLED: 'false',
    N8N_SSRF_PROTECTION_ENABLED: 'false',
    N8N_RUNNERS_ENABLED: 'true',
    N8N_RUNNERS_MODE: 'internal',
    N8N_BLOCK_ENV_ACCESS_IN_NODE: 'true',
    GENERIC_TIMEZONE: options.timezone,
    TZ: options.timezone,
    EXECUTIONS_TIMEOUT: String(options.executionTimeoutSeconds ?? 120),
    EXECUTIONS_TIMEOUT_MAX: String(Math.max(300, options.executionTimeoutSeconds ?? 120)),
  };
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.extra ?? {})) {
    if (!(key in sandbox)) extra[key] = value;
  }
  return { ...extra, ...sandbox };
}

/** Serialises the environment in the `--env-file` format (no quoting, one pair per line). */
export function toEnvFile(env: Record<string, string>): string {
  return (
    Object.entries(env)
      .map(([key, value]) => {
        if (/[\r\n]/.test(value)) throw new Error(`env ${key} contains a newline`);
        return `${key}=${value}`;
      })
      .join('\n') + '\n'
  );
}
