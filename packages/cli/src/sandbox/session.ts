import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { docker, dockerOk, type DockerResult } from './docker.ts';
import { buildN8nEnv, toEnvFile, type N8nEnvOptions } from './env.ts';

export interface SandboxOptions {
  /** Directory on the host that holds rules, capture, certs and work files of this run. */
  runDir: string;
  n8nImage: string;
  proxyImage: string;
  timezone: string;
  logLevel?: N8nEnvOptions['logLevel'];
  extraEnv?: Record<string, string>;
  /** Cached CA per machine; the proxy reuses it and the runner copies the cert for n8n. */
  caDir?: string;
  keep?: boolean;
  log?: (line: string) => void;
}

export const CA_CERT_FILE = 'flowretest-ca.pem';
export const PROXY_PORT = 8080;

/** One sealed sandbox: internal network, proxy container, n8n volume. Every n8n command is its own `docker run --rm`. */
export class SandboxSession {
  readonly id: string;
  readonly network: string;
  readonly volume: string;
  readonly proxyName: string;
  readonly dirs: { rules: string; capture: string; certs: string; work: string; out: string };
  private readonly options: SandboxOptions;
  private readonly envFile: string;
  private readonly caDir: string;
  private started = false;

  constructor(options: SandboxOptions) {
    this.options = options;
    this.id = randomBytes(4).toString('hex');
    this.network = `frt-${this.id}`;
    this.volume = `frt-${this.id}-n8n`;
    this.proxyName = `frt-${this.id}-proxy`;
    this.dirs = {
      rules: join(options.runDir, 'rules'),
      capture: join(options.runDir, 'capture'),
      certs: join(options.runDir, 'certs'),
      work: join(options.runDir, 'work'),
      out: join(options.runDir, 'out'),
    };
    this.envFile = join(options.runDir, 'n8n.env');
    this.caDir = options.caDir ?? join(homedir(), '.flowretest', 'ca');
  }

  private log(line: string): void {
    this.options.log?.(line);
  }

  /** Creates network and volume, starts the proxy and waits for the CA certificate. */
  async start(rules: unknown): Promise<void> {
    for (const dir of Object.values(this.dirs)) mkdirSync(dir, { recursive: true });
    mkdirSync(this.caDir, { recursive: true });
    writeFileSync(join(this.dirs.rules, 'rules.json'), JSON.stringify(rules, null, 2));
    writeFileSync(join(this.dirs.capture, 'current.json'), JSON.stringify({ version: '?', case: '?' }));
    writeFileSync(join(this.dirs.capture, 'requests.jsonl'), '');
    writeFileSync(
      this.envFile,
      toEnvFile(
        buildN8nEnv({
          proxyHost: this.proxyName,
          proxyPort: PROXY_PORT,
          timezone: this.options.timezone,
          logLevel: this.options.logLevel,
          extra: this.options.extraEnv,
        }),
      ),
    );

    await dockerOk(['network', 'create', '--internal', this.network], { timeoutMs: 30_000 });
    await dockerOk(['volume', 'create', this.volume], { timeoutMs: 30_000 });
    this.started = true;
    this.log(`sandbox ${this.id}: network and volume created`);

    await dockerOk(
      [
        'run', '-d', '--name', this.proxyName, '--network', this.network,
        '-v', `${this.dirs.rules}:/rules:ro`,
        '-v', `${this.dirs.capture}:/capture`,
        '-v', `${this.caDir}:/ca`,
        this.options.proxyImage,
      ],
      { timeoutMs: 60_000 },
    );
    await this.waitForCa();
    copyFileSync(join(this.caDir, CA_CERT_FILE), join(this.dirs.certs, CA_CERT_FILE));
    this.log(`sandbox ${this.id}: proxy up, CA ready`);
  }

  private async waitForCa(): Promise<void> {
    const certPath = join(this.caDir, CA_CERT_FILE);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (existsSync(certPath) && readFileSync(certPath, 'utf8').includes('END CERTIFICATE')) return;
      const state = await docker(['inspect', '--format', '{{.State.Running}}', this.proxyName], { timeoutMs: 10_000 });
      if (state.code === 0 && state.stdout.trim() !== 'true') {
        const logs = await docker(['logs', this.proxyName], { timeoutMs: 10_000 });
        throw new Error(`proxy container exited: ${logs.stderr || logs.stdout}`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('proxy did not produce a CA certificate within 30 s');
  }

  /** Marks the capture context for the next command. */
  setContext(version: string, caseId: string): void {
    writeFileSync(join(this.dirs.capture, 'current.json'), JSON.stringify({ version, case: caseId }));
  }

  /** Runs one n8n CLI command through the image entrypoint (which loads the CA). */
  async n8n(args: string[], options: { timeoutMs?: number; withProxy?: boolean; consoleLog?: boolean } = {}): Promise<DockerResult> {
    const dockerArgs = [
      'run', '--rm', '--network', this.network,
      '-v', `${this.volume}:/home/node/.n8n`,
      '-v', `${this.dirs.certs}:/opt/custom-certificates`,
      '-v', `${this.dirs.work}:/work:ro`,
      '-v', `${this.dirs.out}:/out`,
    ];
    if (options.withProxy !== false) dockerArgs.push('--env-file', this.envFile);
    // Commands such as list:workflow print through the n8n logger; `-e` after `--env-file` wins.
    if (options.consoleLog) dockerArgs.push('-e', 'N8N_LOG_OUTPUT=console', '-e', 'N8N_LOG_LEVEL=info', '-e', 'N8N_LOG_FORMAT=json');
    dockerArgs.push(this.options.n8nImage, ...args);
    return docker(dockerArgs, { timeoutMs: options.timeoutMs ?? 180_000 });
  }

  /** Runs an arbitrary program inside the n8n image, bypassing the entrypoint (leak tests, log reads). */
  async exec(entrypoint: string, args: string[], options: { timeoutMs?: number; withProxy?: boolean } = {}): Promise<DockerResult> {
    const dockerArgs = [
      'run', '--rm', '--network', this.network,
      '-v', `${this.volume}:/home/node/.n8n`,
      '--entrypoint', entrypoint,
    ];
    if (options.withProxy) dockerArgs.push('--env-file', this.envFile);
    dockerArgs.push(this.options.n8nImage, ...args);
    return docker(dockerArgs, { timeoutMs: options.timeoutMs ?? 60_000 });
  }

  /** Writes a file into the work directory mounted read-only at /work. */
  writeWork(name: string, content: string): string {
    const path = join(this.dirs.work, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
    return `/work/${name.replace(/\\/g, '/')}`;
  }

  readCapture(): string[] {
    const path = join(this.dirs.capture, 'requests.jsonl');
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() !== '');
  }

  /** Error-level messages from the n8n log inside the volume, newest last. */
  async n8nErrors(limit = 5): Promise<string[]> {
    const result = await this.exec('cat', ['/home/node/.n8n/logs/n8n.log'], { timeoutMs: 30_000 });
    if (result.code !== 0) return [];
    const messages: string[] = [];
    for (const line of result.stdout.split('\n')) {
      if (!line.includes('"level":"error"')) continue;
      try {
        const entry = JSON.parse(line) as { message?: string };
        if (entry.message && !messages.includes(entry.message)) messages.push(entry.message);
      } catch {
        messages.push(line.slice(0, 200));
      }
    }
    return messages.slice(-limit);
  }

  /**
   * Errors that n8n raised before a workflow started (e.g. "Workflow has issues") never reach the
   * CLI output. They sit in execution_data of the sandbox database; copy it out and read it with
   * node:sqlite when available (Node 22.5+).
   */
  async preExecutionErrors(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const dump = join(this.options.runDir, 'db');
    mkdirSync(dump, { recursive: true });
    const copied = await docker(['run', '--rm', '-v', `${this.volume}:/home/node/.n8n:ro`, '-v', `${dump}:/dump`, '--entrypoint', 'sh', this.options.n8nImage, '-c', 'cp /home/node/.n8n/database.sqlite* /dump/ 2>/dev/null; ls /dump'], { timeoutMs: 60_000 });
    if (copied.code !== 0) return out;
    let sqlite: { DatabaseSync: new (path: string, opts?: { readOnly?: boolean }) => { prepare: (sql: string) => { all: (...args: unknown[]) => Array<Record<string, unknown>> }; close: () => void } };
    try {
      sqlite = (await import('node:sqlite')) as unknown as typeof sqlite;
    } catch {
      this.log('node:sqlite is not available (Node 22.5+ needed); pre-execution validation errors stay hidden');
      return out;
    }
    try {
      const db = new sqlite.DatabaseSync(join(dump, 'database.sqlite'), { readOnly: true });
      const rows = db.prepare("select e.workflowId as workflowId, d.data as data from execution_entity e left join execution_data d on d.executionId = e.id where e.status = 'error' order by e.id").all();
      for (const row of rows) {
        const text = String(row.data ?? '');
        const m = /Workflow has issues[^"]{0,400}/.exec(text) ?? /"message","([^"]{0,300})"/.exec(text);
        if (m && typeof row.workflowId === 'string') out.set(row.workflowId, (m[1] ?? m[0]).replace(/\\n/g, ' ').trim());
      }
      db.close();
    } catch (err) {
      this.log(`could not read the sandbox database: ${err instanceof Error ? err.message : String(err)}`);
    }
    return out;
  }

  async proxyLogs(): Promise<string> {
    const result = await docker(['logs', this.proxyName], { timeoutMs: 10_000 });
    return `${result.stdout}${result.stderr}`;
  }

  /** Removes proxy, volume and network. Safe to call twice. */
  async stop(): Promise<void> {
    if (!this.started) return;
    if (this.options.keep) {
      this.log(`sandbox ${this.id} kept: docker rm -f ${this.proxyName}; docker volume rm ${this.volume}; docker network rm ${this.network}`);
      return;
    }
    await docker(['rm', '-f', this.proxyName], { timeoutMs: 30_000 });
    await docker(['volume', 'rm', '-f', this.volume], { timeoutMs: 30_000 });
    await docker(['network', 'rm', this.network], { timeoutMs: 30_000 });
    this.started = false;
    this.log(`sandbox ${this.id}: removed`);
  }

  /** Deletes the run directory; only for throwaway runs such as doctor. */
  cleanupRunDir(): void {
    rmSync(this.options.runDir, { recursive: true, force: true });
  }
}

/** Removes every leftover sandbox resource whose name starts with `frt-`. */
export async function pruneSandboxes(log: (line: string) => void = () => {}): Promise<void> {
  const containers = await docker(['ps', '-aq', '--filter', 'name=^frt-'], { timeoutMs: 30_000 });
  for (const id of containers.stdout.split(/\s+/).filter(Boolean)) {
    await docker(['rm', '-f', id], { timeoutMs: 30_000 });
    log(`removed container ${id}`);
  }
  const volumes = await docker(['volume', 'ls', '-q', '--filter', 'name=^frt-'], { timeoutMs: 30_000 });
  for (const name of volumes.stdout.split(/\s+/).filter(Boolean)) {
    await docker(['volume', 'rm', '-f', name], { timeoutMs: 30_000 });
    log(`removed volume ${name}`);
  }
  const networks = await docker(['network', 'ls', '-q', '--filter', 'name=^frt-'], { timeoutMs: 30_000 });
  for (const id of networks.stdout.split(/\s+/).filter(Boolean)) {
    await docker(['network', 'rm', id], { timeoutMs: 30_000 });
    log(`removed network ${id}`);
  }
}
