import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommanderError } from 'commander';
import { describeError, exitCodeForError } from '../src/errors.ts';

test('errors never end with exit code 1, which means DIFF', () => {
  assert.equal(exitCodeForError(new Error('no .flowretest/config.yml')), 4);
  assert.equal(exitCodeForError(new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') })), 4);
  assert.equal(exitCodeForError(new CommanderError(1, 'commander.missingMandatoryOptionValue', 'required option')), 4);
  assert.equal(exitCodeForError(new CommanderError(0, 'commander.helpDisplayed', '(outputHelp)')), 0);
  assert.equal(exitCodeForError(new TypeError("Cannot read properties of undefined (reading 'x')")), 5);
  assert.equal(exitCodeForError(new ReferenceError('x is not defined')), 5);
});

test('the stack is printed only for internal errors', () => {
  assert.equal(describeError(new Error('docker is not running'), 4), 'flowretest: docker is not running');
  assert.match(describeError(new TypeError('boom'), 5), /^flowretest: boom\n.*TypeError/s);
});
