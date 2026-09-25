import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin.ts';
import { fail, isTokenError, readLimited, tokenHashOf } from '@/lib/api-auth.ts';

export const dynamic = 'force-dynamic';

const Body = z.object({
  appliedCases: z.array(z.string().max(200)).max(500),
  note: z.string().max(2000).optional(),
});

/** `flowretest sync` wrote the baselines of an acceptance; 409 when it was already applied or is not in this workspace. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = tokenHashOf(request);
  if ('response' in auth) return auth.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return fail(404, 'no such acceptance');
  let body: z.infer<typeof Body>;
  try {
    const raw = await readLimited(request, 64 * 1024);
    if ('tooLarge' in raw) return fail(413, 'body is over 64 KB');
    body = Body.parse(JSON.parse(raw.text));
  } catch {
    return fail(400, 'body must be {"appliedCases": [...], "note"?: "..."}');
  }
  const { data, error } = await createAdminClient().rpc('mark_acceptance_applied', { p_token_hash: auth.hash, p_acceptance_id: id, p_applied_cases: body.appliedCases, p_note: body.note ?? '' });
  if (isTokenError(error)) return fail(401, 'invalid or revoked workspace token');
  if (error) {
    console.error('[api/acceptances] mark_acceptance_applied failed:', error.code, error.message);
    return fail(500, 'could not update the acceptance');
  }
  if (!data) return fail(409, 'acceptance already applied or not in this workspace');
  return NextResponse.json({ applied: true });
}
