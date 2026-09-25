-- Fixes of the P1 findings in docs/audyt-2026-09-25.md that live in the database.

-- ---------------------------------------------------------------------------------------------------------------
-- 12. An organization keeps at least one owner. Without one nobody can invite, pay, cancel or delete it, and its
-- subscription keeps charging. Checked at commit, so deleting the whole organization (members go with it) and
-- handing the role over in two statements both work.
-- ---------------------------------------------------------------------------------------------------------------

create function public.keep_an_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.organizations o where o.id = old.organization_id)
    and not exists (select 1 from public.members m where m.organization_id = old.organization_id and m.role = 'owner') then
    raise exception 'An organization needs an owner; make someone else an owner first' using errcode = '42501';
  end if;
  return null;
end;
$$;

revoke all on function public.keep_an_owner from public, anon, authenticated;

create constraint trigger members_keep_an_owner after update or delete on public.members
  deferrable initially deferred
  for each row execute function public.keep_an_owner();

-- ---------------------------------------------------------------------------------------------------------------
-- 16. A scheduled cancellation, whichever way Stripe records it. In flexible billing mode (the default for new
-- subscriptions on API version clover) the portal sets cancel_at and leaves cancel_at_period_end false.
-- ---------------------------------------------------------------------------------------------------------------

alter table public.billing_accounts add column cancel_at timestamptz;
grant select (cancel_at) on public.billing_accounts to authenticated;

-- An organization whose subscription is already scheduled to end may be deleted; the subscription stops by itself.
create or replace function public.prevent_billed_org_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.billing_accounts b
    where b.organization_id = old.id and b.status in ('active', 'trialing', 'past_due', 'unpaid', 'incomplete')
      and not b.cancel_at_period_end and b.cancel_at is null
  ) then
    raise exception 'Cancel the subscription before deleting the organization' using errcode = '53400', hint = 'subscription';
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 24. Two upgrade checks of one workflow to one image at the same moment: the one with the larger id wins, so the
-- cell does not change between page loads. The matrix itself groups images by tag (lib/plans.ts latestPerTag).
-- ---------------------------------------------------------------------------------------------------------------

create or replace view public.latest_upgrade_runs with (security_invoker = true) as
  select distinct on (r.workflow_id, r.engine_to)
    r.id, r.workspace_id, r.workflow_id, r.status, r.engine_from, r.engine_to, r.summary, r.created_at
  from public.runs r
  where r.mode = 'upgrade' and r.engine_to is not null
  order by r.workflow_id, r.engine_to, r.created_at desc, r.id desc;

-- ---------------------------------------------------------------------------------------------------------------
-- 11. Sign-in limits per address and per client. The app calls Supabase Auth from its server, so Auth sees one IP
-- for everybody and its own per-IP limits would lock every user out at once; the app counts attempts here instead,
-- with the visitor's IP from the request, and Auth's limits are raised to cover the whole app (config.toml).
-- ---------------------------------------------------------------------------------------------------------------

create table public.sign_in_attempts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('send', 'verify')),
  email text not null,
  ip text not null,
  at timestamptz not null default now()
);
create index sign_in_attempts_email_idx on public.sign_in_attempts (email, kind, at);
create index sign_in_attempts_ip_idx on public.sign_in_attempts (ip, kind, at);
alter table public.sign_in_attempts enable row level security;
revoke all on public.sign_in_attempts from anon, authenticated;

-- True and recorded when the attempt is within the limits: in 15 minutes an address gets 5 codes and 10 tries at
-- entering one, a client 20 codes and 50 tries (an office behind one IP signs in together).
create function public.note_sign_in_attempt(p_kind text, p_email text, p_ip text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_email integer;
  v_ip integer;
  -- Computed before the IF: plpgsql ends an IF condition at the first THEN, also one inside CASE.
  v_email_limit integer := case p_kind when 'send' then 5 else 10 end;
  v_ip_limit integer := case p_kind when 'send' then 20 else 50 end;
begin
  select count(*) filter (where a.email = lower(p_email)), count(*) filter (where a.ip = p_ip)
    into v_email, v_ip
    from public.sign_in_attempts a
    where a.kind = p_kind and a.at > now() - interval '15 minutes' and (a.email = lower(p_email) or a.ip = p_ip);
  if v_email >= v_email_limit or v_ip >= v_ip_limit then
    return false;
  end if;
  insert into public.sign_in_attempts (kind, email, ip) values (p_kind, lower(p_email), p_ip);
  return true;
end;
$$;

revoke all on function public.note_sign_in_attempt from public, anon, authenticated;
grant execute on function public.note_sign_in_attempt to service_role;

-- Attempts older than a day count for nothing; the nightly purge drops them.
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
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 26. Which version of the workflow a run tested and an acceptance approved (plan section 11: acceptances carry the
-- workflowVersionId). The runner sends the n8n versionId of the new workflow in the redacted report.
-- ---------------------------------------------------------------------------------------------------------------

alter table public.runs add column workflow_version_id text generated always as (report ->> 'workflowVersionId') stored;
alter table public.acceptances add column workflow_version_id text;

create or replace function public.accept_run(p_run_id uuid, p_case_ids text[], p_message text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_run public.runs;
  v_email text;
  v_case text;
  v_status text;
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
  select m.email into v_email from public.members m where m.organization_id = public.workspace_org(v_run.workspace_id) and m.user_id = v_user;
  insert into public.acceptances (workspace_id, workflow_id, run_id, local_run, workflow_version_id, case_ids, message, accepted_by, accepted_by_email)
    values (v_run.workspace_id, v_run.workflow_id, v_run.id, v_run.local_run, v_run.workflow_version_id, (select array_agg(distinct x order by x) from unnest(p_case_ids) x), nullif(btrim(p_message), ''), v_user, coalesce(v_email, ''))
    returning id into v_id;
  return v_id;
end;
$$;

-- A changed result type needs DROP; the grants go with it and are given again.
drop function public.pending_acceptances(text, text);
create function public.pending_acceptances(p_token_hash text, p_n8n_workflow_id text)
returns table (id uuid, local_run text, workflow_version_id text, case_ids text[], message text, accepted_by_email text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_workspace uuid := public.token_workspace(p_token_hash);
begin
  return query
    select a.id, a.local_run, a.workflow_version_id, a.case_ids, a.message, a.accepted_by_email, a.created_at
    from public.acceptances a join public.workflows w on w.id = a.workflow_id
    where a.workspace_id = v_workspace and w.n8n_workflow_id = p_n8n_workflow_id and a.applied_at is null
    order by a.created_at;
end;
$$;
revoke all on function public.pending_acceptances from public, anon, authenticated;
grant execute on function public.pending_acceptances to service_role;
