/**
 * @flowretest/core: pure functions only. No filesystem, no child processes,
 * no Docker. Everything here takes data and returns data so it can be tested
 * without a sandbox and reused by the web app later.
 */
export const CORE_VERSION = '0.0.0';

export * from './types.ts';
export * from './n8n.ts';
export * from './fixture.ts';
export * from './classify.ts';
export * from './rewrite.ts';
export * from './capture.ts';
export * from './normalize.ts';
export * from './diff.ts';
export * from './render.ts';
export * from './baseline.ts';
export * from './scan.ts';
