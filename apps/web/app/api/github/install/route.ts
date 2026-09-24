import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { githubConfig, installUrl, signState } from '@/lib/github.ts';
import { ownerOfWorkspace } from '@/lib/github-link.ts';
import { env } from '@/lib/env.ts';

export const dynamic = 'force-dynamic';

/** "Connect GitHub" on the workspace page: sends an owner to the app's install page with a signed state. */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspace') ?? '';
  const config = githubConfig();
  if (!config || !z.string().uuid().safeParse(workspaceId).success) return NextResponse.redirect(`${env.appUrl()}/orgs`);
  const who = await ownerOfWorkspace(workspaceId);
  if (!who) return NextResponse.redirect(`${env.appUrl()}/login`);
  if (!who.owner) return NextResponse.redirect(`${env.appUrl()}/w/${workspaceId}?github=owner-only`);
  const state = signState(config.clientSecret, { w: workspaceId, u: who.userId, e: Math.floor(Date.now() / 1000) + 900 });
  return NextResponse.redirect(installUrl(config, state));
}
