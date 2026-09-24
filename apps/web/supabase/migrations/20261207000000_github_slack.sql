-- Week 11 of the paid layer: GitHub App with a check per uploaded run, Slack incoming webhooks.

-- The commit a run tested, copied out of the uploaded report (`git`, added by `flowretest upload` in CI).
alter table public.runs
  add column git_repository text generated always as (report -> 'git' ->> 'repository') stored,
  add column git_sha text generated always as (report -> 'git' ->> 'sha') stored,
  add column pull_request integer generated always as ((report -> 'git' ->> 'pullRequest')::integer) stored;

-- A GitHub App installation linked to a workspace. Written only by the setup route after GitHub confirmed, with the
-- linking person's own OAuth token, that the installation is theirs to use (anyone can guess an installation id).
create table public.github_installations (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  installation_id bigint not null,
  account_login text not null,
  account_type text not null,
  suspended_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, installation_id)
);
create index github_installations_installation_idx on public.github_installations (installation_id);

-- Every attempt to post a check, with the check's page when it worked.
create table public.github_checks (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.runs (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  installation_id bigint,
  check_run_id bigint,
  html_url text,
  conclusion text,
  ok boolean not null,
  detail text,
  created_at timestamptz not null default now()
);
create index github_checks_run_idx on public.github_checks (run_id);

-- Slack incoming webhook of a workspace. The URL is a credential (whoever has it can post to the channel), so members
-- read only a hint of it; the service role reads the URL to send.
create table public.slack_webhooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  url text not null check (url ~ '^https?://' and char_length(url) <= 500),
  url_hint text not null,
  statuses text[] not null default array['DIFF', 'ERROR']::text[] check (cardinality(statuses) > 0 and statuses <@ array['PASS', 'DIFF', 'ERROR', 'BLOCKED']::text[]),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index slack_webhooks_workspace_idx on public.slack_webhooks (workspace_id);

alter table public.notification_log drop constraint notification_log_channel_check;
alter table public.notification_log add constraint notification_log_channel_check check (channel in ('email', 'slack'));

alter table public.github_installations enable row level security;
alter table public.github_checks enable row level security;
alter table public.slack_webhooks enable row level security;
revoke all on public.github_installations, public.github_checks, public.slack_webhooks from anon, authenticated;

grant select, delete on public.github_installations to authenticated;
create policy github_installations_select on public.github_installations for select to authenticated using (public.is_member(public.workspace_org(workspace_id)));
create policy github_installations_delete on public.github_installations for delete to authenticated using (public.is_owner(public.workspace_org(workspace_id)));

grant select on public.github_checks to authenticated;
create policy github_checks_select on public.github_checks for select to authenticated using (public.is_member(public.workspace_org(workspace_id)));

grant select (id, workspace_id, url_hint, statuses, created_by, created_at) on public.slack_webhooks to authenticated;
grant insert (workspace_id, url, url_hint, statuses, created_by) on public.slack_webhooks to authenticated;
grant delete on public.slack_webhooks to authenticated;
create policy slack_webhooks_select on public.slack_webhooks for select to authenticated using (public.is_member(public.workspace_org(workspace_id)));
create policy slack_webhooks_insert on public.slack_webhooks for insert to authenticated with check (public.is_owner(public.workspace_org(workspace_id)) and created_by = (select auth.uid()));
create policy slack_webhooks_delete on public.slack_webhooks for delete to authenticated using (public.is_owner(public.workspace_org(workspace_id)));
