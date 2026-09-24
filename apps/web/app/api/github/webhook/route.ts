import { NextResponse, type NextRequest } from 'next/server';
import { githubConfig, verifyWebhookSignature } from '@/lib/github.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

export const dynamic = 'force-dynamic';

interface InstallationEvent {
  action?: string;
  installation?: { id?: number; account?: { login?: string } };
  account?: { login?: string };
}

/** Keeps linked installations in step with GitHub: uninstalled, suspended, unsuspended, account renamed. */
export async function POST(request: NextRequest) {
  const config = githubConfig();
  if (!config) return NextResponse.json({ error: 'GitHub App not configured' }, { status: 404 });
  const raw = await request.text();
  if (!verifyWebhookSignature(config.webhookSecret, raw, request.headers.get('x-hub-signature-256'))) return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  const event = request.headers.get('x-github-event');
  const payload = JSON.parse(raw) as InstallationEvent;
  const id = payload.installation?.id;
  if (!id) return new NextResponse(null, { status: 204 });
  const table = createAdminClient().from('github_installations');
  if (event === 'installation' && payload.action === 'deleted') await table.delete().eq('installation_id', id);
  else if (event === 'installation' && payload.action === 'suspend') await table.update({ suspended_at: new Date().toISOString() }).eq('installation_id', id);
  else if (event === 'installation' && payload.action === 'unsuspend') await table.update({ suspended_at: null }).eq('installation_id', id);
  else if (event === 'installation_target' && payload.action === 'renamed' && payload.account?.login) await table.update({ account_login: payload.account.login }).eq('installation_id', id);
  return new NextResponse(null, { status: 204 });
}
