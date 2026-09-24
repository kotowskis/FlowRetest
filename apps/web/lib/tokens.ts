import { createHash, randomBytes } from 'node:crypto';

/** Workspace tokens look like `frt_` + 43 base64url characters (32 random bytes). */
export const TOKEN_PREFIX = 'frt_';
const TOKEN_RE = /^frt_[A-Za-z0-9_-]{43}$/;

export interface NewToken {
  /** Shown to the user once, then only its hash is kept. */
  token: string;
  hash: string;
  /** `frt_AbCd`: enough to tell tokens apart in a list or a CI log. */
  prefix: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateToken(): NewToken {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token), prefix: token.slice(0, TOKEN_PREFIX.length + 4) };
}

/**
 * The token from an `Authorization: Bearer frt_...` header, or undefined when the header is missing or malformed.
 * A malformed value is refused before any database lookup.
 */
export function bearerToken(header: string | null | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? '');
  const token = match?.[1];
  return token && TOKEN_RE.test(token) ? token : undefined;
}
