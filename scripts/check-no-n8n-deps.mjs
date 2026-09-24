#!/usr/bin/env node
/**
 * Fails when any workspace package or the lockfile pulls in n8n code.
 * The runner must never contain n8n; it talks to n8n only through the public
 * API, the CLI inside the official image and the workflow JSON format.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = /^(n8n|n8n-core|n8n-workflow|n8n-nodes-base|n8n-design-system|n8n-editor-ui|@n8n\/.*)$/;
const root = process.cwd();
const offenders = [];

function checkDeps(where, deps) {
  for (const name of Object.keys(deps ?? {})) {
    if (FORBIDDEN.test(name)) offenders.push(`${where}: ${name}`);
  }
}

const manifests = [join(root, 'package.json')];
const packagesDir = join(root, 'packages');
if (existsSync(packagesDir)) {
  for (const dir of readdirSync(packagesDir)) {
    const manifest = join(packagesDir, dir, 'package.json');
    if (existsSync(manifest)) manifests.push(manifest);
  }
}
for (const manifest of manifests) {
  const json = JSON.parse(readFileSync(manifest, 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    checkDeps(`${manifest} (${field})`, json[field]);
  }
}

const lock = join(root, 'package-lock.json');
if (existsSync(lock)) {
  const json = JSON.parse(readFileSync(lock, 'utf8'));
  for (const key of Object.keys(json.packages ?? {})) {
    const name = key.replace(/^.*node_modules\//, '');
    if (name && FORBIDDEN.test(name)) offenders.push(`package-lock.json: ${key}`);
  }
}

if (offenders.length > 0) {
  console.error('n8n packages are not allowed in the runner:');
  for (const line of offenders) console.error(`  ${line}`);
  process.exit(1);
}
console.log('OK: no n8n packages in dependencies');
