import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Redactor, type Fixture } from '@flowretest/core';
import { loadConfig, workflowDir } from '../config.ts';

export interface RedactOptions {
  cwd: string;
  workflowId: string;
  outDir?: string;
  keepFields?: string[];
  log: (line: string) => void;
}

/** Writes redacted copies of every fixture of a workflow; the originals stay where they are. */
export function runRedact(options: RedactOptions): string[] {
  loadConfig(options.cwd);
  const dir = workflowDir(options.cwd, options.workflowId);
  const fixturesDir = join(dir, 'fixtures');
  if (!existsSync(fixturesDir)) throw new Error(`no fixtures in ${fixturesDir}; run \`flowretest pull\` first`);
  const outDir = options.outDir ?? join(dir, 'fixtures-redacted');
  mkdirSync(outDir, { recursive: true });
  const redactor = new Redactor({ keepFields: options.keepFields });
  const written: string[] = [];
  for (const file of readdirSync(fixturesDir).filter((f) => f.endsWith('.json'))) {
    const fixture = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as Fixture;
    const out = redactor.redactFixture(fixture);
    const path = join(outDir, file);
    writeFileSync(path, JSON.stringify(out));
    written.push(path);
  }
  options.log(`${written.length} redacted fixture${written.length === 1 ? '' : 's'} in ${outDir}; names, emails and phones replaced, identifiers and dates kept`);
  return written;
}
