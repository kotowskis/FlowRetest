#!/usr/bin/env node
import { DEFAULT_CONFIG, startProxy } from './server.ts';

const server = await startProxy(DEFAULT_CONFIG);
console.log(`flowretest-proxy listening on ${server.port}; rules=${DEFAULT_CONFIG.rulesPath} capture=${DEFAULT_CONFIG.captureDir}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.stop().finally(() => process.exit(0));
  });
}
