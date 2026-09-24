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

/** 28000 is what the token-checking database functions raise for an unknown or revoked token. */
export function isTokenError(error: { code?: string } | null): boolean {
  return error?.code === '28000';
}
