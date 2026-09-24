import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { ConfigSchema, parseOrThrow } from '@flowretest/schemas';

export const CONFIG_DIR = '.flowretest';
export const CONFIG_FILE = 'config.yml';
export const SECRETS_FILE = 'secrets.env';

export interface Config {
  schemaVersion: 1;
  instance: { url: string };
  engine: { image: string; tag: string; timezone: string; env?: Record<string, string> };
  proxy: { image: string };
  normalize: { ignore: string[]; idSegments?: string[] };
  run: { timeoutSeconds: number; stabilize: boolean; executor?: 'batch' | 'execute' };
}

export function defaultConfig(url: string, tag: string, timezone: string): Config {
  return {
    schemaVersion: 1,
    instance: { url: url.replace(/\/+$/, '') },
    engine: { image: 'n8nio/n8n', tag, timezone },
    proxy: { image: 'flowretest-proxy:dev' },
    normalize: { ignore: [] },
    run: { timeoutSeconds: 120, stabilize: false, executor: 'batch' },
  };
}

export function configDir(cwd: string): string {
  return join(cwd, CONFIG_DIR);
}

export function loadConfig(cwd: string): Config {
  const path = join(configDir(cwd), CONFIG_FILE);
  if (!existsSync(path)) throw new Error(`no ${CONFIG_DIR}/${CONFIG_FILE} in ${cwd}; run \`flowretest init\` first`);
  return parseOrThrow(ConfigSchema, parse(readFileSync(path, 'utf8')), `${CONFIG_DIR}/${CONFIG_FILE}`) as Config;
}

export function saveConfig(cwd: string, config: Config): string {
  mkdirSync(configDir(cwd), { recursive: true });
  const path = join(configDir(cwd), CONFIG_FILE);
  writeFileSync(path, stringify(config));
  return path;
}

export function saveApiKey(cwd: string, apiKey: string): void {
  mkdirSync(configDir(cwd), { recursive: true });
  writeFileSync(join(configDir(cwd), SECRETS_FILE), `FLOWRETEST_API_KEY=${apiKey}\n`, { mode: 0o600 });
}

export function loadApiKey(cwd: string): string {
  const fromEnv = process.env.FLOWRETEST_API_KEY;
  if (fromEnv) return fromEnv;
  const path = join(configDir(cwd), SECRETS_FILE);
  if (!existsSync(path)) throw new Error(`no API key: set FLOWRETEST_API_KEY or run \`flowretest init --api-key\``);
  const line = readFileSync(path, 'utf8').split('\n').find((l) => l.startsWith('FLOWRETEST_API_KEY='));
  if (!line) throw new Error(`${path} has no FLOWRETEST_API_KEY line`);
  return line.slice('FLOWRETEST_API_KEY='.length).trim();
}

/** Adds the ignore rules for secrets, fixtures and runs once. */
export function ensureGitignore(cwd: string): string[] {
  const path = join(cwd, '.gitignore');
  const wanted = [`${CONFIG_DIR}/${SECRETS_FILE}`, `${CONFIG_DIR}/*/fixtures/`, `${CONFIG_DIR}/*/runs/`];
  const existing = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];
  const added = wanted.filter((w) => !existing.includes(w));
  if (added.length > 0) appendFileSync(path, `${existing.length && existing[existing.length - 1] !== '' ? '\n' : ''}${added.join('\n')}\n`);
  return added;
}

export function workflowDir(cwd: string, workflowId: string): string {
  return join(configDir(cwd), workflowId);
}
