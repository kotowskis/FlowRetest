#!/usr/bin/env node
/**
 * Writes docs/formaty/<name>.schema.json from the zod schemas in packages/schemas.
 * Run after `npm run build`: node scripts/export-schemas.mjs
 * With --check nothing is written; it exits 1 and names the files that differ (CI keeps the docs in step).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const check = process.argv.includes('--check');
const { ALL_SCHEMAS, jsonSchemaOf } = await import('../packages/schemas/dist/index.js');
const outDir = join(process.cwd(), 'docs', 'formaty');
mkdirSync(outDir, { recursive: true });
const stale = [];
for (const name of Object.keys(ALL_SCHEMAS)) {
  const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `https://flowretest.dev/schemas/${name}.schema.json`, title: `flowretest ${name}`, ...jsonSchemaOf(name) };
  const file = join(outDir, `${name}.schema.json`);
  const text = JSON.stringify(schema, null, 2) + '\n';
  if (check) {
    if (!existsSync(file) || readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== text) stale.push(`docs/formaty/${name}.schema.json`);
    continue;
  }
  writeFileSync(file, text);
  console.log(`docs/formaty/${name}.schema.json`);
}
if (check) {
  if (stale.length > 0) {
    console.error(`out of date, run \`npm run build -w @flowretest/schemas && npm run schemas\`:\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log('docs/formaty matches packages/schemas');
}
