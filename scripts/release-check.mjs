// Guards for release.yml. A release that would publish the wrong version, to the wrong dist-tag, or with a CLI
// pointing at a proxy image users cannot pull must stop here instead of going green.
//
//   node scripts/release-check.mjs version <git-tag>          checks the tag against every package version, prints dist-tag
//   node scripts/release-check.mjs lock <image> <tag> <digest> writes packages/cli/proxy.lock.json
//   node scripts/release-check.mjs package                     checks the CLI package right before npm publish
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cliDir = join(root, 'packages', 'cli');
const lockPath = join(cliDir, 'proxy.lock.json');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function fail(message) {
  console.error(`release-check: ${message}`);
  process.exit(1);
}

function output(name, value) {
  console.log(`${name}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function checkVersion(gitTag) {
  if (!gitTag?.startsWith('v')) fail(`tag "${gitTag}" does not start with v`);
  const version = gitTag.slice(1);
  const packages = readdirSync(join(root, 'packages')).map((d) => join(root, 'packages', d, 'package.json')).filter(existsSync);
  for (const path of packages) {
    const pkg = readJson(path);
    if (pkg.version !== version) fail(`${pkg.name} is ${pkg.version}, the tag says ${version}; bump the versions or tag v${pkg.version}`);
  }
  const cliVersion = readFileSync(join(cliDir, 'src', 'index.ts'), 'utf8').match(/CLI_VERSION = '([^']+)'/)?.[1];
  if (cliVersion !== version) fail(`CLI_VERSION in packages/cli/src/index.ts is ${cliVersion}, the tag says ${version}`);
  output('version', version);
  output('dist-tag', version.includes('-') ? 'next' : 'latest');
}

function writeLock(image, tag, digest) {
  if (!image || image !== image.toLowerCase()) fail(`image "${image}" must be lower case (GHCR rejects upper case)`);
  if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? '')) fail(`digest "${digest}" is not sha256:<64 hex>`);
  const lock = { image, tag, digest, note: 'written by release.yml after the proxy image was pushed; commit it back to main' };
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`proxy.lock.json: ${image}@${digest}`);
}

function checkPackage() {
  const pkg = readJson(join(cliDir, 'package.json'));
  if (pkg.private) fail('packages/cli is private; npm publish would skip it and exit 0');
  const lock = readJson(lockPath);
  if (!lock.digest) fail('proxy.lock.json has no digest; the published CLI would fall back to the local dev proxy image');
  if (lock.tag !== pkg.version) fail(`proxy.lock.json tag ${lock.tag} differs from the CLI version ${pkg.version}`);
  const bin = join(cliDir, 'dist', 'bin.js');
  if (!existsSync(bin) || !readFileSync(bin, 'utf8').startsWith('#!/usr/bin/env node')) fail('dist/bin.js is missing or has no shebang; run npm run build');
  for (const dep of Object.keys(pkg.dependencies ?? {})) if (dep.startsWith('@flowretest/')) fail(`${dep} is a dependency, but workspace packages are bundled and never published`);
  console.log(`release-check: ${pkg.name}@${pkg.version} is ready, proxy ${lock.image}@${lock.digest}`);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'version') checkVersion(args[0]);
else if (command === 'lock') writeLock(args[0], args[1], args[2]);
else if (command === 'package') checkPackage();
else fail('usage: release-check.mjs version <tag> | lock <image> <tag> <digest> | package');
