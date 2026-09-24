/** Intercepting proxy for the sandbox. Reads /rules/rules.json, writes /capture/requests.jsonl. */
export const PROXY_VERSION = '0.0.0';

export * from './rules.ts';
export * from './multipart.ts';
export * from './capture.ts';
