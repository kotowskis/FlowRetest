// Bundles the CLI into dist/ for npm. The workspace packages (@flowretest/core, schemas, services) are private
// and inlined here; npm dependencies stay external and are installed with the package.
import { build } from 'esbuild';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));

rmSync(`${root}dist`, { recursive: true, force: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/bin.ts', 'src/index.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: [...Object.keys(pkg.dependencies ?? {}), 'node:*'],
  sourcemap: true,
  logLevel: 'warning',
});

const version = readFileSync(`${root}src/index.ts`, 'utf8').match(/CLI_VERSION = '([^']+)'/)?.[1];
if (version !== pkg.version) throw new Error(`src/index.ts CLI_VERSION (${version}) differs from package.json (${pkg.version})`);
writeFileSync(`${root}dist/index.d.ts`, `export declare const CLI_VERSION = ${JSON.stringify(version)};\n`);
