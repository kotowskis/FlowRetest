/** Row level security: an organization's data is visible to its members only, and runs are written by ingest_run only. */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateToken } from '../../lib/tokens.ts';
import { admin, anon, supabaseMissing, user, type Db, mustRun } from './helpers.ts';

const skip = mustRun(await supabaseMissing());

interface World {
  a: { db: Db; id: string; email: string };
  b: { db: Db; id: string; email: string };
  orgId: string;
  workspaceId: string;
  tokenHash: string;
}
let world: World;

before(async () => {
  if (skip) return;
  const a = await user('owner');
  const b = await user('outsider');
  const org = await a.db.rpc('create_organization', { p_name: 'RLS Agency' });
  assert.ifError(org.error);
  const ws = await a.db.from('workspaces').insert({ organization_id: org.data as string, name: 'Customer' }).select('id').single();
  assert.ifError(ws.error);
  const t = generateToken();
  const tok = await a.db.from('workspace_tokens').insert({ workspace_id: ws.data!.id, name: 'ci', token_hash: t.hash, token_prefix: t.prefix, created_by: a.id });
  assert.ifError(tok.error);
  world = { a, b, orgId: org.data as string, workspaceId: ws.data!.id, tokenHash: t.hash };
});

function ingestArgs(tokenHash: string) {
  return {
    p_token_hash: tokenHash,
    p_n8n_workflow_id: 'wf1',
    p_workflow_name: 'Lead intake',
    p_status: 'PASS',
    p_mode: 'change',
    p_runner: '0.3.0',
    p_engine_image: 'n8nio/n8n:2.40.5',
    p_old_label: 'recorded',
    p_new_label: 'draft.json',
    p_sealed: true,
    p_local_run: '',
    p_summary: { cases: 0 },
    p_report: { cases: [] },
    p_report_bytes: 10,
    p_generated_at: new Date().toISOString(),
  };
}

test('the creator is the owner; an outsider sees no organization, workspace, token or run', { skip }, async () => {
  const { a, b, orgId, workspaceId, tokenHash } = world;
  const ingested = await admin().rpc('ingest_run', ingestArgs(tokenHash));
  assert.ifError(ingested.error);
  const members = await a.db.from('members').select('role, email').eq('organization_id', orgId);
  assert.deepEqual(members.data, [{ role: 'owner', email: a.email }]);
  assert.equal((await a.db.from('runs').select('id').eq('workspace_id', workspaceId)).data?.length, 1);

  for (const table of ['organizations', 'members', 'workspaces', 'workflows', 'runs', 'invitations'] as const) {
    const res = await b.db.from(table).select('*');
    assert.ifError(res.error);
    assert.equal(res.data?.length, 0, `outsider reads ${table}`);
  }
  assert.equal((await b.db.from('workspace_tokens').select('id')).data?.length, 0);
  const anonRead = await anon().from('organizations').select('*');
  assert.ok(anonRead.error || anonRead.data?.length === 0, 'anon reads organizations');
});

test('an outsider cannot write into the organization, and nobody reads token hashes back', { skip }, async () => {
  const { a, b, orgId, workspaceId } = world;
  const ws = await b.db.from('workspaces').insert({ organization_id: orgId, name: 'Intruder' });
  assert.ok(ws.error, 'outsider created a workspace');
  const t = generateToken();
  const tok = await b.db.from('workspace_tokens').insert({ workspace_id: workspaceId, name: 'x', token_hash: t.hash, token_prefix: t.prefix, created_by: b.id });
  assert.ok(tok.error, 'outsider created a token');
  const inv = await b.db.from('invitations').insert({ organization_id: orgId, email: b.email, invited_by: b.id });
  assert.ok(inv.error, 'outsider invited themselves');
  const hash = await a.db.from('workspace_tokens').select('token_hash');
  assert.ok(hash.error, 'owner read token_hash');
  const renamed = await b.db.from('organizations').update({ name: 'Taken' }).eq('id', orgId).select('id');
  assert.equal(renamed.data?.length ?? 0, 0);
});

test('only the service role can call ingest_run; a revoked or unknown token is refused', { skip }, async () => {
  const { a, workspaceId, tokenHash } = world;
  const asUser = await a.db.rpc('ingest_run', ingestArgs(tokenHash));
  assert.ok(asUser.error, 'a signed-in user called ingest_run');
  const unknown = await admin().rpc('ingest_run', ingestArgs('0'.repeat(64)));
  assert.equal(unknown.error?.code, '28000');

  const t = generateToken();
  const created = await a.db.from('workspace_tokens').insert({ workspace_id: workspaceId, name: 'old', token_hash: t.hash, token_prefix: t.prefix, created_by: a.id }).select('id').single();
  assert.ifError(created.error);
  const revoked = await a.db.from('workspace_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', created.data!.id);
  assert.ifError(revoked.error);
  const refused = await admin().rpc('ingest_run', ingestArgs(t.hash));
  assert.equal(refused.error?.code, '28000');
  const hashChange = await a.db.from('workspace_tokens').update({ token_hash: t.hash } as never).eq('id', created.data!.id);
  assert.ok(hashChange.error, 'a member rewrote a token hash');
});

test('an invited address becomes a member at its next sign-in; a member cannot remove the owner', { skip }, async () => {
  const { a, orgId } = world;
  const c = await user('invitee');
  const inv = await a.db.from('invitations').insert({ organization_id: orgId, email: c.email, invited_by: a.id });
  assert.ifError(inv.error);
  const claimed = await c.db.rpc('claim_invitations');
  assert.equal(claimed.data, 1);
  assert.equal((await c.db.from('organizations').select('id').eq('id', orgId)).data?.length, 1);
  assert.equal((await a.db.from('invitations').select('id').eq('organization_id', orgId)).data?.length, 0);
  const kick = await c.db.from('members').delete().eq('organization_id', orgId).eq('user_id', a.id).select('user_id');
  assert.equal(kick.data?.length ?? 0, 0);
  const ws = await c.db.from('workspaces').delete().eq('organization_id', orgId).select('id');
  assert.equal(ws.data?.length ?? 0, 0, 'a member deleted a workspace');
});
