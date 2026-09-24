import 'server-only';
import { createClient } from './supabase/server.ts';

/** The signed-in user and whether they own the workspace's organization; RLS answers both. */
export async function ownerOfWorkspace(workspaceId: string): Promise<{ userId: string; owner: boolean } | undefined> {
  const db = await createClient();
  const { data } = await db.auth.getUser();
  if (!data.user) return undefined;
  const { data: ws } = await db.from('workspaces').select('organization_id').eq('id', workspaceId).maybeSingle();
  if (!ws) return { userId: data.user.id, owner: false };
  const { data: owner } = await db.rpc('is_owner', { org: ws.organization_id });
  return { userId: data.user.id, owner: owner === true };
}
