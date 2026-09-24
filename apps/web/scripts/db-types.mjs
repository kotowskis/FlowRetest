// Regenerates lib/database.types.ts from the local database (npm run db:start first). Commit the result after
// every migration; `--check` compares instead of writing, for CI.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../lib/database.types.ts', import.meta.url));
// cwd: the supabase project lives in apps/web, and CI calls this script from the repository root.
const res = spawnSync('npx supabase gen types typescript --local --schema public', { encoding: 'utf8', shell: true, cwd: fileURLToPath(new URL('..', import.meta.url)) });
if (res.status !== 0) {
  console.error(res.stderr);
  process.exit(res.status ?? 1);
}
const text = res.stdout.replace(/\r\n/g, '\n');
if (process.argv.includes('--check')) {
  if (readFileSync(out, 'utf8') !== text) {
    console.error('lib/database.types.ts is out of date: run npm run db:types -w @flowretest/web and commit it');
    process.exit(1);
  }
  console.log('database types up to date');
} else {
  writeFileSync(out, text);
  console.log('wrote lib/database.types.ts');
}
