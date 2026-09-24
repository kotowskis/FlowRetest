import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin.ts';
import { fail, isTokenError, tokenHashOf } from '@/lib/api-auth.ts';

export const dynamic = 'force-dynamic';

/** `flowretest sync`: acceptances of one workflow in the token's workspace that no runner has applied yet. */
export async function GET(request: NextRequest) {
  const auth = tokenHashOf(request);
  if ('response' in auth) return auth.response;
  const workflow = request.nextUrl.searchParams.get('workflow');
  if (!workflow || workflow.length > 200) return fail(400, 'query parameter workflow (the n8n workflow id) is required');
  const { data, error } = await createAdminClient().rpc('pending_acceptances', { p_token_hash: auth.hash, p_n8n_workflow_id: workflow });
  if (isTokenError(error)) return fail(401, 'invalid or revoked workspace token');
  if (error) {
    console.error('[api/acceptances] pending_acceptances failed:', error.code, error.message);
    return fail(500, 'could not read acceptances');
  }
  return NextResponse.json({
    acceptances: (data ?? []).map((a) => ({ id: a.id, localRun: a.local_run, caseIds: a.case_ids, message: a.message, acceptedBy: a.accepted_by_email, createdAt: a.created_at })),
  });
}
