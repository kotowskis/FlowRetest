-- Week 9 of the paid layer (plan section 11): organizations, members, invitations, workspaces, workspace tokens,
-- workflows and uploaded runs. Everything a signed-in user reads goes through RLS; runs are written only by
-- ingest_run(), called by POST /api/runs with the service role after the report passed validation.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Copied at join time: auth.users is not readable through RLS, and the member list needs a name to show.
  email text not null,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index members_user_idx on public.members (user_id);

-- An owner invites an email address; the person becomes a member the next time they sign in with it.
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  role text not null default 'member' check (role in ('owner', 'member')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);
create index invitations_email_idx on public.invitations (email);

-- One customer instance of an agency: the n8n host and the engine tag it runs.
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  instance_host text check (instance_host is null or char_length(instance_host) <= 255),
  engine_tag text check (engine_tag is null or char_length(engine_tag) <= 64),
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);
create index workspaces_org_idx on public.workspaces (organization_id);

-- FLOWRETEST_TOKEN values. Only the SHA-256 of the token is stored; the token itself is shown once.
create table public.workspace_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- The first characters of the token, so people can tell tokens apart in the list and in CI logs.
  token_prefix text not null check (char_length(token_prefix) <= 16),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index workspace_tokens_workspace_idx on public.workspace_tokens (workspace_id);

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  n8n_workflow_id text not null check (char_length(n8n_workflow_id) between 1 and 200),
  name text not null,
  last_run_at timestamptz,
  last_status text,
  created_at timestamptz not null default now(),
  unique (workspace_id, n8n_workflow_id)
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  token_id uuid references public.workspace_tokens (id) on delete set null,
  status text not null check (status in ('PASS', 'DIFF', 'ERROR', 'BLOCKED')),
  mode text not null check (mode in ('change', 'upgrade')),
  runner text not null,
  engine_image text not null,
  old_label text not null,
  new_label text not null,
  sealed boolean not null,
  -- Run directory name on the runner's machine, to find the full local report.
  local_run text,
  -- {"cases": n, "PASS": n, "DIFF": n, ..., "changed": n, "added": n, "removed": n, "blocked": n}
  summary jsonb not null,
  -- The redacted report as uploaded (RedactedReportSchema); never the full report.
  report jsonb not null,
  report_bytes integer not null,
  generated_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index runs_workflow_created_idx on public.runs (workflow_id, created_at desc);
create index runs_workspace_created_idx on public.runs (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- Membership helpers. SECURITY DEFINER so policies on members do not recurse into themselves.
-- ---------------------------------------------------------------------------------------------------------------

create function public.is_member(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.organization_id = org and m.user_id = (select auth.uid()));
$$;

create function public.is_owner(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.organization_id = org and m.user_id = (select auth.uid()) and m.role = 'owner');
$$;

create function public.workspace_org(ws uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select w.organization_id from public.workspaces w where w.id = ws;
$$;

-- Creates an organization with the caller as its owner, in one transaction.
create function public.create_organization(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_org uuid;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select u.email into v_email from auth.users u where u.id = v_user;
  insert into public.organizations (name, created_by) values (btrim(p_name), v_user) returning id into v_org;
  insert into public.members (organization_id, user_id, email, role) values (v_org, v_user, coalesce(v_email, ''), 'owner');
  return v_org;
end;
$$;

-- Turns pending invitations for the caller's (confirmed) email into memberships. Called after every sign-in.
create function public.claim_invitations() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_count integer;
begin
  if v_user is null then
    return 0;
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_user and u.email_confirmed_at is not null;
  if v_email is null then
    return 0;
  end if;
  insert into public.members (organization_id, user_id, email, role)
    select i.organization_id, v_user, v_email, i.role from public.invitations i where i.email = v_email
    on conflict (organization_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  delete from public.invitations i where i.email = v_email;
  return v_count;
end;
$$;

-- Ingests one uploaded run for the workspace the token belongs to. Only the API route calls it (service role),
-- after checking the report with RedactedReportSchema and the redaction guard; the token check lives here so
-- a revoked token is refused inside the same transaction that writes the run.
create function public.ingest_run(
  p_token_hash text,
  p_n8n_workflow_id text,
  p_workflow_name text,
  p_status text,
  p_mode text,
  p_runner text,
  p_engine_image text,
  p_old_label text,
  p_new_label text,
  p_sealed boolean,
  p_local_run text,
  p_summary jsonb,
  p_report jsonb,
  p_report_bytes integer,
  p_generated_at timestamptz
) returns table (run_id uuid, workspace_id uuid)
language plpgsql security definer set search_path = '' as $$
-- The OUT columns run_id and workspace_id would shadow table columns of the same name.
#variable_conflict use_column
declare
  v_token public.workspace_tokens;
  v_workflow uuid;
  v_run uuid;
begin
  select * into v_token from public.workspace_tokens t where t.token_hash = p_token_hash and t.revoked_at is null;
  if not found then
    raise exception 'invalid token' using errcode = '28000';
  end if;
  insert into public.workflows as w (workspace_id, n8n_workflow_id, name, last_run_at, last_status)
    values (v_token.workspace_id, p_n8n_workflow_id, p_workflow_name, now(), p_status)
    on conflict (workspace_id, n8n_workflow_id)
    do update set name = excluded.name, last_run_at = excluded.last_run_at, last_status = excluded.last_status
    returning w.id into v_workflow;
  insert into public.runs (workspace_id, workflow_id, token_id, status, mode, runner, engine_image, old_label, new_label, sealed, local_run, summary, report, report_bytes, generated_at)
    values (v_token.workspace_id, v_workflow, v_token.id, p_status, p_mode, p_runner, p_engine_image, p_old_label, p_new_label, p_sealed, nullif(p_local_run, ''), p_summary, p_report, p_report_bytes, p_generated_at)
    returning id into v_run;
  update public.workspace_tokens set last_used_at = now() where id = v_token.id;
  return query select v_run, v_token.workspace_id;
end;
$$;

revoke all on function public.ingest_run from public, anon, authenticated;
grant execute on function public.ingest_run to service_role;
revoke all on function public.create_organization, public.claim_invitations from public, anon;
grant execute on function public.create_organization, public.claim_invitations to authenticated;
revoke all on function public.is_member, public.is_owner, public.workspace_org from public, anon;
grant execute on function public.is_member, public.is_owner, public.workspace_org to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Grants and row level security. anon reads nothing; authenticated gets only what a policy allows.
-- ---------------------------------------------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.members enable row level security;
alter table public.invitations enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_tokens enable row level security;
alter table public.workflows enable row level security;
alter table public.runs enable row level security;

revoke all on public.organizations, public.members, public.invitations, public.workspaces, public.workspace_tokens, public.workflows, public.runs from anon, authenticated;

grant select on public.organizations to authenticated;
grant update (name) on public.organizations to authenticated;
grant delete on public.organizations to authenticated;
create policy organizations_select on public.organizations for select to authenticated using (public.is_member(id));
create policy organizations_update on public.organizations for update to authenticated using (public.is_owner(id)) with check (public.is_owner(id));
create policy organizations_delete on public.organizations for delete to authenticated using (public.is_owner(id));

grant select, delete on public.members to authenticated;
grant update (role) on public.members to authenticated;
create policy members_select on public.members for select to authenticated using (public.is_member(organization_id));
create policy members_update on public.members for update to authenticated using (public.is_owner(organization_id)) with check (public.is_owner(organization_id));
-- Owners remove anyone; a member may leave.
create policy members_delete on public.members for delete to authenticated using (public.is_owner(organization_id) or user_id = (select auth.uid()));

grant select, insert, delete on public.invitations to authenticated;
create policy invitations_select on public.invitations for select to authenticated using (public.is_member(organization_id));
create policy invitations_insert on public.invitations for insert to authenticated with check (public.is_owner(organization_id) and invited_by = (select auth.uid()));
create policy invitations_delete on public.invitations for delete to authenticated using (public.is_owner(organization_id));

grant select, insert, delete on public.workspaces to authenticated;
grant update (name, instance_host, engine_tag) on public.workspaces to authenticated;
create policy workspaces_select on public.workspaces for select to authenticated using (public.is_member(organization_id));
create policy workspaces_insert on public.workspaces for insert to authenticated with check (public.is_member(organization_id));
create policy workspaces_update on public.workspaces for update to authenticated using (public.is_member(organization_id)) with check (public.is_member(organization_id));
create policy workspaces_delete on public.workspaces for delete to authenticated using (public.is_owner(organization_id));

-- token_hash is not granted for reading: nobody needs it back, and a hash of a leaked table is still a lookup key.
grant select (id, workspace_id, name, token_prefix, created_by, created_at, last_used_at, revoked_at) on public.workspace_tokens to authenticated;
grant insert (workspace_id, name, token_hash, token_prefix, created_by) on public.workspace_tokens to authenticated;
grant update (revoked_at) on public.workspace_tokens to authenticated;
create policy workspace_tokens_select on public.workspace_tokens for select to authenticated using (public.is_member(public.workspace_org(workspace_id)));
create policy workspace_tokens_insert on public.workspace_tokens for insert to authenticated with check (public.is_member(public.workspace_org(workspace_id)) and created_by = (select auth.uid()));
create policy workspace_tokens_update on public.workspace_tokens for update to authenticated using (public.is_member(public.workspace_org(workspace_id))) with check (public.is_member(public.workspace_org(workspace_id)));

grant select on public.workflows to authenticated;
create policy workflows_select on public.workflows for select to authenticated using (public.is_member(public.workspace_org(workspace_id)));

grant select, delete on public.runs to authenticated;
create policy runs_select on public.runs for select to authenticated using (public.is_member(public.workspace_org(workspace_id)));
create policy runs_delete on public.runs for delete to authenticated using (public.is_owner(public.workspace_org(workspace_id)));
