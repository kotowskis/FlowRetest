import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';

/** What a sandbox writes to `sandbox.json` in its directory when it starts; `sandbox export --compose` reads it. */
export interface SandboxManifest {
  schemaVersion: 1;
  id: string;
  network: string;
  volume: string;
  proxyName: string;
  n8nImage: string;
  proxyImage: string;
  dirs: { rules: string; capture: string; certs: string; work: string; out: string };
  envFile: string;
  caDir: string;
  /** `--user` of the proxy container on Linux hosts. */
  user?: string;
  createdAt: string;
}

export const MANIFEST_FILE = 'sandbox.json';
/** Pinned so the exported file starts the same helper everywhere. */
export const SOCAT_IMAGE = 'alpine/socat:1.8.0.3';

const bind = (source: string, target: string, readOnly = false) => ({ type: 'bind', source, target, ...(readOnly ? { read_only: true } : {}) });

/**
 * A docker-compose file that starts the kept sandbox again for debugging: the same proxy with the same rules and CA,
 * and n8n as `n8n start` on the same volume, so the rewritten workflows and their executions open in the editor.
 * n8n stays on the internal network only; the editor is reached through a socat container that sits on both
 * networks and listens on 127.0.0.1:5678, so the workflows still have no route out.
 */
export function composeFor(m: SandboxManifest): Record<string, unknown> {
  return {
    name: `${m.network}-debug`,
    services: {
      proxy: {
        image: m.proxyImage,
        ...(m.user ? { user: m.user } : {}),
        // The n8n env file points HTTP(S)_PROXY at this name.
        networks: { sandbox: { aliases: [m.proxyName] } },
        volumes: [bind(m.dirs.rules, '/rules', true), bind(m.dirs.capture, '/capture'), bind(m.caDir, '/ca')],
      },
      n8n: {
        image: m.n8nImage,
        command: ['start'],
        env_file: [m.envFile],
        environment: { N8N_LOG_OUTPUT: 'console', N8N_PUBLIC_API_DISABLED: 'false' },
        networks: ['sandbox'],
        volumes: [{ type: 'volume', source: 'n8n-data', target: '/home/node/.n8n' }, bind(m.dirs.certs, '/opt/custom-certificates'), bind(m.dirs.work, '/work', true)],
        depends_on: ['proxy'],
      },
      editor: {
        image: SOCAT_IMAGE,
        command: ['TCP-LISTEN:5678,fork,reuseaddr', 'TCP:n8n:5678'],
        ports: ['127.0.0.1:5678:5678'],
        networks: ['sandbox', 'editor'],
        depends_on: ['n8n'],
      },
    },
    networks: { sandbox: { internal: true }, editor: {} },
    volumes: { 'n8n-data': { external: true, name: m.volume } },
  };
}

/** Writes docker-compose.yml for a kept sandbox directory; returns its path. */
export function exportCompose(sandboxDir: string, outFile?: string): string {
  const dir = resolve(sandboxDir);
  const manifestPath = join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) throw new Error(`${manifestPath} not found; export works on a sandbox kept with \`run --keep\` or \`doctor --keep\``);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as SandboxManifest;
  const out = outFile ? resolve(outFile) : join(dir, 'docker-compose.yml');
  const header = [
    `# FlowRetest sandbox ${manifest.id}, exported for debugging (${new Date().toISOString()}).`,
    '# docker compose -f <this file> up, then open http://127.0.0.1:5678 (n8n asks for an owner account on first start).',
    '# n8n sits on an internal network only; the editor is forwarded by socat. Stop with `docker compose down`;',
    `# the volume ${manifest.volume} stays until \`flowretest sandbox prune\`.`,
    '',
  ].join('\n');
  writeFileSync(out, header + stringify(composeFor(manifest)));
  return out;
}
