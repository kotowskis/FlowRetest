// Writes .env.local from the running local Supabase (`npm run db:start` first). Used by developers and CI.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const status = execSync('npx supabase status -o env', { encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) });
const values = Object.fromEntries(
  status
    .split(/\r?\n/)
    .map((line) => /^([A-Z_]+)="?(.*?)"?$/.exec(line))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
for (const key of ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY']) if (!values[key]) throw new Error(`supabase status has no ${key}; is the local stack running?`);
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:3100';
const out = fileURLToPath(new URL('../.env.local', import.meta.url));
writeFileSync(out, [`NEXT_PUBLIC_SUPABASE_URL=${values.API_URL}`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=${values.ANON_KEY}`, `SUPABASE_SERVICE_ROLE_KEY=${values.SERVICE_ROLE_KEY}`, `APP_URL=${appUrl}`, `MAILPIT_URL=${values.MAILPIT_URL ?? ''}`, ''].join('\n'));
console.log(`wrote ${out}`);
