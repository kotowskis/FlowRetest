import { CommanderError } from 'commander';
import { EXIT_CODES } from '@flowretest/core';

/**
 * Exit code for an error that escaped a command. Exit code 1 means DIFF, so a crash must never end with it:
 * usage and environment problems (Docker, API, files, config) are 4, programming errors are 5.
 */
export function exitCodeForError(e: unknown): number {
  if (e instanceof CommanderError) return e.exitCode === 0 ? 0 : EXIT_CODES.ENVIRONMENT;
  if (isInternal(e)) return EXIT_CODES.INTERNAL;
  return EXIT_CODES.ENVIRONMENT;
}

/** Bugs rather than environment problems; `fetch failed` is a TypeError with a cause and stays an environment problem. */
function isInternal(e: unknown): boolean {
  if (e instanceof ReferenceError) return true;
  return e instanceof TypeError && e.cause === undefined;
}

/** One line for the user, the stack only for internal errors or with FLOWRETEST_DEBUG=1. */
export function describeError(e: unknown, code: number): string {
  if (!(e instanceof Error)) return `flowretest: ${String(e)}`;
  const cause = e.cause instanceof Error ? ` (${e.cause.message})` : '';
  const head = `flowretest: ${e.message}${cause}`;
  if (code === EXIT_CODES.INTERNAL || process.env.FLOWRETEST_DEBUG === '1') return `${head}\n${e.stack ?? ''}`;
  return head;
}
