import { spawn } from 'node:child_process';

export interface DockerResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface DockerRunOptions {
  timeoutMs?: number;
  stdin?: string;
}

export class DockerError extends Error {
  readonly result: DockerResult;
  readonly args: string[];

  constructor(args: string[], result: DockerResult) {
    super(`docker ${args.slice(0, 3).join(' ')}… exited with ${result.code}: ${result.stderr.trim().split('\n').slice(-3).join(' | ')}`);
    this.name = 'DockerError';
    this.args = args;
    this.result = result;
  }
}

/** Runs the docker CLI. Kept as a plain spawn so the runner has no docker client dependency. */
export function docker(args: string[], options: DockerRunOptions = {}): Promise<DockerResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, options.timeoutMs)
      : undefined;
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      // --verbose: every docker command on stderr, so it never mixes with a --json result on stdout.
      if (process.env.FLOWRETEST_VERBOSE === '1') console.error(`docker ${args.join(' ')} -> ${timedOut ? 'timeout' : code} (${Date.now() - started} ms)`);
      const result: DockerResult = {
        code: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr: timedOut ? `${stderr}\n(timed out after ${options.timeoutMs} ms)` : stderr,
        durationMs: Date.now() - started,
      };
      resolve(result);
    });
    if (options.stdin !== undefined) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

/** Same as docker() but rejects on a non-zero exit code. */
export async function dockerOk(args: string[], options: DockerRunOptions = {}): Promise<DockerResult> {
  const result = await docker(args, options);
  if (result.code !== 0) throw new DockerError(args, result);
  return result;
}

/** True when the daemon answers; false when the CLI is missing or the daemon is down. */
export async function dockerAvailable(): Promise<{ ok: boolean; detail: string }> {
  try {
    const result = await docker(['info', '--format', '{{.ServerVersion}} {{.OSType}} {{.Architecture}}'], { timeoutMs: 15_000 });
    if (result.code === 0) return { ok: true, detail: result.stdout.trim() };
    return { ok: false, detail: result.stderr.trim().split('\n')[0] ?? 'docker info failed' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function imagePresent(image: string): Promise<boolean> {
  const result = await docker(['image', 'inspect', '--format', '{{.Id}}', image], { timeoutMs: 15_000 });
  return result.code === 0;
}

export async function imageDigest(image: string): Promise<string | undefined> {
  const result = await docker(['image', 'inspect', '--format', '{{index .RepoDigests 0}}', image], { timeoutMs: 15_000 });
  if (result.code !== 0) return undefined;
  const value = result.stdout.trim();
  return value === '' || value === '<no value>' ? undefined : value;
}
