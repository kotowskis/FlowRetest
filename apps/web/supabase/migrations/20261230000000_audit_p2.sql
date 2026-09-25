-- Fixes of the P2 findings in docs/audyt-2026-09-25.md that live in the database.

-- ---------------------------------------------------------------------------------------------------------------
-- Uploads per 24 hours are counted in their own append-only table: deleting runs no longer resets the limit.
-- ---------------------------------------------------------------------------------------------------------------

create table public.upload_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  at timestamptz not null default now()
);
create index upload_events_org_at_idx on public.upload_events (organization_id, at);
alter table public.upload_events enable row level security;
revoke all on public.upload_events from anon, authenticated;

insert into public.upload_events (organization_id, at)
  select w.organization_id, r.created_at from public.runs r join public.workspaces w on w.id = r.workspace_id
  where r.created_at > now() - interval '24 hours';

-- ---------------------------------------------------------------------------------------------------------------
-- An invitation for someone who is already a member would take a second seat; it is refused. A member's address is
-- refreshed at every sign-in and notifications go to the current address of the account.
-- ---------------------------------------------------------------------------------------------------------------

create function public.refuse_member_invitation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.members m left join auth.users u on u.id = m.user_id
    where m.organization_id = new.organization_id and (lower(m.email) = lower(new.email) or lower(u.email) = lower(new.email))
  ) then
    raise exception '% is already a member of this organization', new.email using errcode = '23505', hint = 'member';
  end if;
  return new;
end;
$$;

revoke all on function public.refuse_member_invitation from public, anon, authenticated;

create trigger invitations_not_members before insert on public.invitations
  for each row execute function public.refuse_member_invitation();

create or replace function public.claim_invitations() returns integer
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
  update public.members m set email = v_email where m.user_id = v_user and m.email is distinct from v_email;
  insert into public.members (organization_id, user_id, email, role)
    select i.organization_id, v_user, v_email, i.role from public.invitations i where i.email = v_email
    on conflict (organization_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  delete from public.invitations i where i.email = v_email;
  return v_count;
end;
$$;

create or replace function public.run_recipients(p_run_id uuid)
returns table (email text)
language sql stable security definer set search_path = '' as $$
  select distinct coalesce(u.email, m.email)
  from public.runs r
  join public.workspaces w on w.id = r.workspace_id
  join public.notification_subscriptions s on s.workspace_id = r.workspace_id and r.status = any (s.statuses)
  join public.members m on m.organization_id = w.organization_id and m.user_id = s.user_id
  left join auth.users u on u.id = m.user_id
  where r.id = p_run_id and coalesce(u.email, m.email) <> '';
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- org_plan: uploads from upload_events; a subscription that was never paid (incomplete) gets no grace period.
-- ---------------------------------------------------------------------------------------------------------------

create or replace function public.org_plan(org uuid)
returns table (
  plan text,
  workspaces integer,
  seats integer,
  retention_days integer,
  uploads_per_day integer,
  integrations boolean,
  workspaces_used integer,
  seats_used integer,
  uploads_last_day integer,
  pdf_export boolean,
  drift_matrix boolean
)
language sql stable security definer set search_path = '' as $$
  with account as (
    select b.plan, b.status, b.ended_at, b.previous_plan, b.plan_changed_at from public.billing_accounts b where b.organization_id = org
  ),
  current_plan as (
    select coalesce((select a.plan from account a where public.subscription_gives_plan(a.status) and a.plan is not null), 'free') as id
  ),
  -- For 30 days after a paid plan ends or is replaced by a smaller one, runs are kept as long as that plan kept them.
  -- A subscription whose first payment never went through (incomplete) was never a paid plan.
  grace as (
    select p.retention_days from account a join public.plans p on p.id = a.plan
    where not public.subscription_gives_plan(a.status) and a.status not in ('incomplete', 'incomplete_expired')
      and a.ended_at > now() - interval '30 days'
    union all
    select p.retention_days from account a join public.plans p on p.id = a.previous_plan
    where a.plan_changed_at > now() - interval '30 days'
  )
  select
    p.id,
    p.workspaces,
    p.seats,
    greatest(p.retention_days, coalesce((select max(g.retention_days) from grace g), 0)),
    p.uploads_per_day,
    p.integrations,
    (select count(*)::integer from public.workspaces w where w.organization_id = org),
    (select count(*)::integer from public.members m where m.organization_id = org)
      + (select count(*)::integer from public.invitations i where i.organization_id = org),
    (select count(*)::integer from public.upload_events e where e.organization_id = org and e.at > now() - interval '24 hours'),
    p.pdf_export,
    p.drift_matrix
  from public.plans p
  -- A signed-in caller sees only organizations they belong to; the service role and cron have no auth.uid().
  where p.id = (select c.id from current_plan c)
    and ((select auth.uid()) is null or public.is_member(org));
$$;

-- ingest_run from week 12, now recording the upload in upload_events inside the same transaction.
create or replace function public.ingest_run(
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
  v_org uuid;
  v_limits record;
  v_workflow uuid;
  v_run uuid;
begin
  select * into v_token from public.workspace_tokens t where t.token_hash = p_token_hash and t.revoked_at is null;
  if not found then
    raise exception 'invalid token' using errcode = '28000';
  end if;
  v_org := public.workspace_org(v_token.workspace_id);
  perform pg_advisory_xact_lock(hashtextextended(v_org::text, 0));
  select * into v_limits from public.org_plan(v_org);
  if public.workspace_over_limit(v_token.workspace_id) then
    raise exception 'This workspace is past the limit of the % plan (% workspace%, oldest first)', initcap(v_limits.plan), v_limits.workspaces, case when v_limits.workspaces = 1 then '' else 's' end
      using errcode = '53400', hint = 'workspace-over-limit';
  end if;
  if v_limits.uploads_last_day >= v_limits.uploads_per_day then
    raise exception 'The % plan accepts % uploads per organization in 24 hours', initcap(v_limits.plan), v_limits.uploads_per_day
      using errcode = '53400', hint = 'uploads';
  end if;
  insert into public.workflows as w (workspace_id, n8n_workflow_id, name, last_run_at, last_status)
    values (v_token.workspace_id, p_n8n_workflow_id, p_workflow_name, now(), p_status)
    on conflict (workspace_id, n8n_workflow_id)
    do update set name = excluded.name, last_run_at = excluded.last_run_at, last_status = excluded.last_status
    returning w.id into v_workflow;
  insert into public.runs (workspace_id, workflow_id, token_id, status, mode, runner, engine_image, old_label, new_label, sealed, local_run, summary, report, report_bytes, generated_at)
    values (v_token.workspace_id, v_workflow, v_token.id, p_status, p_mode, p_runner, p_engine_image, p_old_label, p_new_label, p_sealed, nullif(p_local_run, ''), p_summary, p_report, p_report_bytes, p_generated_at)
    returning id into v_run;
  insert into public.upload_events (organization_id) values (v_org);
  update public.workspace_tokens set last_used_at = now() where id = v_token.id;
  return query select v_run, v_token.workspace_id;
end;
$$;

create or replace function public.purge_expired_runs() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  delete from public.runs r
    using public.workspaces w, lateral public.org_plan(w.organization_id) l
    where w.id = r.workspace_id and r.created_at < now() - make_interval(days => l.retention_days);
  get diagnostics v_count = row_count;
  delete from public.stripe_events e where e.received_at < now() - interval '90 days';
  delete from public.sign_in_attempts a where a.at < now() - interval '1 day';
  delete from public.upload_events e where e.at < now() - interval '2 days';
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- workspace_org answers only for members (and for the service role, cron and triggers, which have no auth.uid()).
-- Policies call it as is_member(workspace_org(...)), so for everybody else the answer stays "no".
-- ---------------------------------------------------------------------------------------------------------------

create or replace function public.workspace_org(ws uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select w.organization_id from public.workspaces w
  where w.id = ws
    and ((select auth.uid()) is null or exists (select 1 from public.members m where m.organization_id = w.organization_id and m.user_id = (select auth.uid())));
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- A second submit of the same acceptance (same run, same cases, not yet applied) returns the first one.
-- ---------------------------------------------------------------------------------------------------------------

create or replace function public.accept_run(p_run_id uuid, p_case_ids text[], p_message text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_run public.runs;
  v_email text;
  v_case text;
  v_status text;
  v_cases text[];
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into v_run from public.runs r where r.id = p_run_id;
  if not found or not public.is_member(public.workspace_org(v_run.workspace_id)) then
    raise exception 'run not found' using errcode = 'P0002';
  end if;
  if p_case_ids is null or cardinality(p_case_ids) = 0 then
    raise exception 'choose at least one case' using errcode = '22023';
  end if;
  foreach v_case in array p_case_ids loop
    select c ->> 'status' into v_status from jsonb_array_elements(v_run.report -> 'cases') c where c ->> 'caseId' = v_case;
    if v_status is null then
      raise exception 'case % is not in this run', v_case using errcode = '22023';
    end if;
    if v_status not in ('PASS', 'DIFF') then
      raise exception 'case % is %, only PASS and DIFF cases can be accepted', v_case, v_status using errcode = '22023';
    end if;
    if coalesce((v_run.report -> 'stability' ->> v_case)::boolean, false) is not true then
      raise exception 'case % was not proven stable; run it with --stabilize and upload again', v_case using errcode = '22023';
    end if;
  end loop;
  v_cases := (select array_agg(distinct x order by x) from unnest(p_case_ids) x);
  -- The lock keeps two submits in flight from both passing the check below.
  perform pg_advisory_xact_lock(hashtextextended(v_run.id::text, 1));
  select a.id into v_id from public.acceptances a
    where a.run_id = v_run.id and a.case_ids = v_cases and a.applied_at is null and a.accepted_by = v_user;
  if found then
    return v_id;
  end if;
  select m.email into v_email from public.members m where m.organization_id = public.workspace_org(v_run.workspace_id) and m.user_id = v_user;
  insert into public.acceptances (workspace_id, workflow_id, run_id, local_run, workflow_version_id, case_ids, message, accepted_by, accepted_by_email)
    values (v_run.workspace_id, v_run.workflow_id, v_run.id, v_run.local_run, v_run.workflow_version_id, v_cases, nullif(btrim(p_message), ''), v_user, coalesce(v_email, ''))
    returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- The drift matrix is an Agency feature in the database too, not only on the page (ADR 0010: limits live here).
-- ---------------------------------------------------------------------------------------------------------------

create function public.drift_matrix_allowed(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select l.drift_matrix from public.workspaces w, lateral public.org_plan(w.organization_id) l where w.id = ws), false);
$$;
revoke all on function public.drift_matrix_allowed from public, anon;
grant execute on function public.drift_matrix_allowed to authenticated, service_role;

create or replace view public.latest_upgrade_runs with (security_invoker = true) as
  select distinct on (r.workflow_id, r.engine_to)
    r.id, r.workspace_id, r.workflow_id, r.status, r.engine_from, r.engine_to, r.summary, r.created_at
  from public.runs r
  where r.mode = 'upgrade' and r.engine_to is not null and public.drift_matrix_allowed(r.workspace_id)
  order by r.workflow_id, r.engine_to, r.created_at desc, r.id desc;
