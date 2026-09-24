import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { N8nClient } from '../api/client.ts';
import { configDir, CONFIG_FILE, defaultConfig, defaultProxyImage, ensureGitignore, loadConfig, saveApiKey, saveConfig, type Config } from '../config.ts';
import { dockerAvailable } from '../sandbox/docker.ts';

export interface InitOptions {
  cwd: string;
  url: string;
  apiKey?: string;
  engine?: string;
  timezone?: string;
  /** Replace an existing config.yml instead of updating it. */
  force?: boolean;
  log: (line: string) => void;
}

/** Proxy images this CLI manages; a config pointing at one of them follows the CLI version, anything else is kept. */
function isManagedProxyImage(image: string): boolean {
  return image.startsWith('flowretest-proxy:') || /^ghcr\.io\/[^/]+\/flowretest-proxy[:@]/.test(image);
}

/**
 * An existing config.yml keeps everything the user tuned (normalize.ignore, run settings, engine env, a custom proxy
 * image); init only refreshes the instance, the engine tag, the timezone when given, and a managed proxy image.
 * The GitHub Action runs init on every job, so rewriting the file from scratch would drop the committed settings.
 */
export function mergeConfig(existing: Config, fresh: Config, timezoneGiven: boolean): Config {
  return {
    ...existing,
    instance: { ...existing.instance, url: fresh.instance.url },
    engine: { ...existing.engine, tag: fresh.engine.tag, timezone: timezoneGiven ? fresh.engine.timezone : existing.engine.timezone },
    proxy: { ...existing.proxy, image: isManagedProxyImage(existing.proxy.image) ? defaultProxyImage() : existing.proxy.image },
  };
}

export async function runInit(options: InitOptions): Promise<void> {
  const apiKey = options.apiKey ?? process.env.FLOWRETEST_API_KEY;
  if (!apiKey) throw new Error('an API key is required: --api-key <key> or FLOWRETEST_API_KEY');
  const client = new N8nClient(options.url, apiKey);
  let engine = options.engine;
  if (!engine) {
    engine = await client.detectVersion(options.url);
    if (engine) options.log(`detected n8n ${engine} at ${options.url}`);
    else throw new Error('could not detect the n8n version; pass --engine <tag> (the tag of the n8nio/n8n image your instance runs)');
  }
  const major = Number(engine.split('.')[0]);
  if (Number.isFinite(major) && major < 2) options.log(`warning: n8n ${engine} is below 2.20; the sandbox relies on the global proxy agents of 2.x and will most likely capture nothing`);
  const fresh = defaultConfig(options.url, engine, options.timezone ?? 'UTC');
  const exists = existsSync(join(configDir(options.cwd), CONFIG_FILE));
  const config = exists && !options.force ? mergeConfig(loadConfig(options.cwd), fresh, options.timezone !== undefined) : fresh;
  const path = saveConfig(options.cwd, config);
  saveApiKey(options.cwd, apiKey);
  const added = ensureGitignore(options.cwd);
  const docker = await dockerAvailable();
  options.log(`${exists && !options.force ? 'updated' : 'wrote'} ${path}${added.length ? ` and ${added.length} .gitignore rule${added.length === 1 ? '' : 's'}` : ''}`);
  options.log(docker.ok ? `docker: ${docker.detail}` : `warning: docker is not available (${docker.detail}); \`run\` needs it`);
}
