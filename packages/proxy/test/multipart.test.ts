import { test } from 'node:test';
import assert from 'node:assert/strict';
import { multipartBoundary, parseMultipart } from '../src/multipart.ts';

test('parses names, filenames and sizes without keeping bytes', () => {
  const boundary = 'XyZ';
  const body = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="field"\r\n\r\nhello\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 data\r\n` +
      `--${boundary}--\r\n`,
  );
  assert.equal(multipartBoundary(`multipart/form-data; boundary=${boundary}`), boundary);
  const parts = parseMultipart(body, boundary);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map((p) => [p.name, p.filename, p.size]), [['field', undefined, 5], ['file', 'a.pdf', 13]]);
  assert.equal(parts[1]?.contentType, 'application/pdf');
  assert.match(parts[1]?.sha256 ?? '', /^[0-9a-f]{64}$/);
});

test('boundary helper ignores non-multipart types', () => {
  assert.equal(multipartBoundary('application/json'), undefined);
  assert.equal(multipartBoundary(undefined), undefined);
});
