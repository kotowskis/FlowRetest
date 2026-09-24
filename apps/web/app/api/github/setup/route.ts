import { NextResponse, type NextRequest } from 'next/server';
import { authorizeUrl, exchangeCode, githubConfig, signState, userInstallations, verifyState } from '@/lib/github.ts';
import { ownerOfWorkspace } from '@/lib/github-link.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';
import { env } from '@/lib/env.ts';

export const dynamic = 'force-dynamic';

/**
 * Setup URL of the GitHub App (and its OAuth callback). An installation id in a URL proves nothing, so the link is
 * written only when GitHub lists that installation among the ones the signed-in person can access, with their own
 * OAuth token. Without a code (the app does not ask for authorization on install) the person goes through OAuth once.
 */
export async function GET(request: NextRequest) {
  const config = githubConfig();
  if (!config) return NextResponse.redirect(`${env.appUrl()}/orgs`);
  const params = request.nextUrl.searchParams;
  const state = verifyState(config.clientSecret, params.get('state'));
  if (!state) return NextResponse.redirect(`${env.appUrl()}/orgs?github=expired`);
  const back = (result: string) => NextResponse.redirect(`${env.appUrl()}/w/${state.w}?github=${result}#github`);

  const who = await ownerOfWorkspace(state.w);
  if (!who) return NextResponse.redirect(`${env.appUrl()}/login`);
  if (who.userId !== state.u || !who.owner) return back('owner-only');

  const installationId = Number(params.get('installation_id') ?? state.i ?? NaN);
  if (params.get('setup_action') === 'request') return back('requested');
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return back('no-installation');

  const code = params.get('code');
  if (!code) {
    const next = signState(config.clientSecret, { ...state, i: installationId, e: Math.floor(Date.now() / 1000) + 900 });
    return NextResponse.redirect(authorizeUrl(config, next, `${env.appUrl()}/api/github/setup`));
  }
  try {
    const token = await exchangeCode(config, code);
    const installation = (await userInstallations(config, token)).find((i) => i.id === installationId);
    if (!installation) return back('not-yours');
    const { error } = await createAdminClient()
      .from('github_installations')
      .upsert({ workspace_id: state.w, installation_id: installation.id, account_login: installation.account.login, account_type: installation.account.type, created_by: who.userId, suspended_at: null }, { onConflict: 'workspace_id,installation_id' });
    if (error) throw new Error(error.message);
    return back('linked');
  } catch (e) {
    console.error('[github/setup]', e instanceof Error ? e.message : e);
    return back('error');
  }
}
