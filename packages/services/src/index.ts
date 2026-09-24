/**
 * Per-service data: operation roles, sink templates and credential stubs.
 * Adding a service must not touch @flowretest/core.
 */
export * from './credentials.ts';
export * from './roles.ts';
export * from './sinks.ts';

export { SUPPORTED_SERVICE_TYPES as SERVICES } from './roles.ts';
