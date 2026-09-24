import { N8nClient } from '../api/client.ts';
import { defaultConfig, ensureGitignore, saveApiKey, saveConfig } from '../config.ts';
import { dockerAvailable } from '../sandbox/docker.ts';

export interface InitOptions {
  cwd: string;
  url: string;
  apiKey?: string;
  engine?: string;
  timezone?: string;
  log: (line: string) => void;
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
  const config = defaultConfig(options.url, engine, options.timezone ?? 'UTC');
  const path = saveConfig(options.cwd, config);
  saveApiKey(options.cwd, apiKey);
  const added = ensureGitignore(options.cwd);
  const docker = await dockerAvailable();
  options.log(`wrote ${path}${added.length ? ` and ${added.length} .gitignore rule${added.length === 1 ? '' : 's'}` : ''}`);
  options.log(docker.ok ? `docker: ${docker.detail}` : `warning: docker is not available (${docker.detail}); \`run\` needs it`);
}
