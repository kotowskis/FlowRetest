#!/usr/bin/env node
/**
 * Writes docs/formaty/<name>.schema.json from the zod schemas in packages/schemas.
 * Run after `npm run build`: node scripts/export-schemas.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { ALL_SCHEMAS, jsonSchemaOf } = await import('../packages/schemas/dist/index.js');
const outDir = join(process.cwd(), 'docs', 'formaty');
mkdirSync(outDir, { recursive: true });
for (const name of Object.keys(ALL_SCHEMAS)) {
  const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `https://flowretest.dev/schemas/${name}.schema.json`, title: `flowretest ${name}`, ...jsonSchemaOf(name) };
  writeFileSync(join(outDir, `${name}.schema.json`), JSON.stringify(schema, null, 2) + '\n');
  console.log(`docs/formaty/${name}.schema.json`);
}
