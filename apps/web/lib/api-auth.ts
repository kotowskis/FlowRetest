import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { bearerToken, hashToken } from './tokens.ts';

export function fail(status: number, error: string, details?: string[]) {
  return NextResponse.json(details ? { error, details } : { error }, { status });
}

/** SHA-256 of the bearer token, or the 401 response to return. The database functions check it against live tokens. */
export function tokenHashOf(request: NextRequest): { hash: string } | { response: NextResponse } {
  const token = bearerToken(request.headers.get('authorization'));
  if (!token) return { response: fail(401, 'missing or malformed workspace token (Authorization: Bearer frt_...)') };
  return { hash: hashToken(token) };
}

/**
 * The request body as text, read up to `limit` bytes. A chunked request has no Content-Length, so the stream is
 * counted as it arrives and dropped past the limit instead of being buffered whole.
 */
export async function readLimited(request: Request, limit: number): Promise<{ text: string } | { tooLarge: number }> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > limit) return { tooLarge: declared };
  if (!request.body) return { text: '' };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return { tooLarge: size };
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf8') };
}

/**
 * Reads and drops the rest of a refused request's body, up to `limit` bytes. Answering before the body is read made
 * some clients see a reset connection instead of the answer (about 1 upload in 200 with a bad token and 4.5 MB);
 * the bytes are counted, not kept or parsed, so a refused upload still costs no memory (audit of week 14, item 32).
 */
export async function discardBody(request: Request, limit: number): Promise<void> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (!request.body || declared > limit) return;
  const reader = request.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return;
      }
    }
  } catch {
    // The client went away; there is nobody left to answer.
  }
}

/** 28000 is what the token-checking database functions raise for an unknown or revoked token. */
export function isTokenError(error: { code?: string } | null): boolean {
  return error?.code === '28000';
}
