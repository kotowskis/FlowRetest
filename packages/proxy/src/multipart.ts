import { createHash } from 'node:crypto';

export interface MultipartPart {
  name: string;
  filename?: string;
  contentType?: string;
  size: number;
  sha256: string;
}

/** Extracts the boundary from a multipart content-type header. */
export function multipartBoundary(contentType: string | undefined): string | undefined {
  if (!contentType || !/^multipart\//i.test(contentType)) return undefined;
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return (m?.[1] ?? m?.[2])?.trim();
}

/** Minimal multipart/form-data parser: names, filenames, sizes and hashes; never keeps file bytes. */
export function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    const start = cursor + delimiter.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    const segment = body.subarray(start, next);
    const headerEnd = segment.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerText = segment.subarray(0, headerEnd).toString('utf8');
      let content = segment.subarray(headerEnd + 4);
      if (content.subarray(-2).toString() === '\r\n') content = content.subarray(0, -2);
      const name = /name="([^"]*)"/i.exec(headerText)?.[1] ?? '';
      const filename = /filename="([^"]*)"/i.exec(headerText)?.[1];
      const contentType = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim();
      parts.push({
        name,
        filename,
        contentType,
        size: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
      });
    }
    cursor = next;
  }
  return parts;
}
