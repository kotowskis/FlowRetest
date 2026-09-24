import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parse } from 'yaml';
import { parseOrThrow, StubsFileSchema } from '@flowretest/schemas';
import { workflowDir } from './config.ts';

export const STUBS_FILE = 'stubs.yml';

/** Output items of one stubbed node and where they came from (shown in the plan). */
export interface LoadedStub {
  items: unknown[];
  source: string;
}

/**
 * Items from a stub file: a JSON or YAML array of item objects, an object with an `items` array, or a single object
 * standing for one item.
 */
export function stubItems(content: unknown, source: string): unknown[] {
  if (Array.isArray(content)) return content;
  if (content !== null && typeof content === 'object') {
    const items = (content as { items?: unknown }).items;
    if (items !== undefined) {
      if (!Array.isArray(items)) throw new Error(`${source}: "items" must be an array`);
      return items;
    }
    return [content];
  }
  throw new Error(`${source}: a stub is an array of items, an object with "items", or one item object`);
}

function readStubFile(path: string): unknown[] {
  if (!existsSync(path)) throw new Error(`stub file ${path} does not exist`);
  const text = readFileSync(path, 'utf8');
  const content = /\.ya?ml$/i.test(path) ? parse(text) : JSON.parse(text);
  return stubItems(content, path);
}

/** `--stub "Upsert order=stubs/upsert.json"`; the last `=` splits, since node names may contain one. */
export function parseStubFlag(flag: string): { node: string; file: string } {
  const at = flag.lastIndexOf('=');
  const node = flag.slice(0, at).trim();
  const file = flag.slice(at + 1).trim();
  if (at <= 0 || !node || !file) throw new Error(`--stub expects "<node name>=<file.json>", got "${flag}"`);
  return { node, file };
}

/**
 * Stubs for a workflow: `.flowretest/<workflow>/stubs.yml` first, then `--stub` flags, which win for the same node.
 * File paths in stubs.yml are relative to that file, flag paths to the working directory.
 */
export function loadStubs(cwd: string, workflowId: string, flags: string[] = []): Record<string, LoadedStub> {
  const out: Record<string, LoadedStub> = {};
  const stubsPath = join(workflowDir(cwd, workflowId), STUBS_FILE);
  if (existsSync(stubsPath)) {
    const file = parseOrThrow(StubsFileSchema, parse(readFileSync(stubsPath, 'utf8')), stubsPath);
    for (const [node, entry] of Object.entries(file.stubs)) {
      if ('items' in entry) out[node] = { items: entry.items, source: STUBS_FILE };
      else {
        const path = isAbsolute(entry.file) ? entry.file : resolve(dirname(stubsPath), entry.file);
        out[node] = { items: readStubFile(path), source: `${STUBS_FILE} (${entry.file})` };
      }
    }
  }
  for (const flag of flags) {
    const { node, file } = parseStubFlag(flag);
    out[node] = { items: readStubFile(isAbsolute(file) ? file : resolve(cwd, file)), source: `--stub ${file}` };
  }
  return out;
}
