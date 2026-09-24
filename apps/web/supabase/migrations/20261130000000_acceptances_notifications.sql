-- Week 10 of the paid layer: acceptances with history, baseline sync with the runner, email notifications.
--
-- An acceptance is a decision, not a baseline: the hosted layer holds only redacted reports, and a baseline holds
-- real request bodies. The runner that has the full local report of the accepted run writes the baseline and
-- marks the acceptance applied (pending_acceptances, mark_acceptance_applied).

create table public.acceptances (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  -- The history outlives a deleted run; local_run keeps what the runner needs to find the report.
  run_id uuid references public.runs (id) on delete set null,
  local_run text,
  case_ids text[] not null check (cardinality(case_ids) between 1 and 500),
  message text check (message is null or char_length(message) <= 2000),
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_by_email text not null,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  applied_token_id uuid references public.workspace_tokens (id) on delete set null,
  -- Case ids the runner wrote baselines for, and why the others were not written.
  applied_cases text[],
  applied_note text check (applied_note is null or char_length(applied_note) <= 2000)
);
create index acceptances_workflow_created_idx on public.acceptances (workflow_id, created_at desc);
create index acceptances_pending_idx on public.acceptances (workspace_id) where applied_at is null;

-- A member asks to be emailed about runs of one workspace with these statuses. Only members' own addresses:
-- an arbitrary address would make the service a relay.
create table public.notification_subscriptions (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  statuses text[] not null default array['DIFF', 'ERROR']::text[] check (statuses <@ array['PASS', 'DIFF', 'ERROR', 'BLOCKED']::text[]),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- What was sent, for support and for tests. Written by the service role only.
create table public.notification_log (
  id bigint generated always as identity primary key,
  run_id uuid references public.runs (id) on delete cascade,
  channel text not null check (channel in ('email')),
  recipient text not null,
  ok boolean not null,
  detail text,
  created_at timestamptz not null default now()
);
create index notification_log_run_idx on public.notification_log (run_id);

-- ---------------------------------------------------------------------------------------------------------------
-- Accepting from the app. Checks the cases against the stored report: only PASS or DIFF cases whose new version
-- was proven stable by `run --stabilize` (the same rule as `flowretest accept` without --force).
-- ---------------------------------------------------------------------------------------------------------------

create function public.accept_run(p_run_id uuid, p_case_ids text[], p_message text) returns uuid
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
  insert into public.acceptances (workspace_id, workflow_id, run_id, local_run, case_ids, message, accepted_by, accepted_by_email)
    values (v_run.workspace_id, v_run.workflow_id, v_run.id, v_run.local_run, (select array_agg(distinct x order by x) from unnest(p_case_ids) x), nullif(btrim(p_message), ''), v_user, coalesce(v_email, ''))
    returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Runner side, called by the API routes with the service role after the token check below.
-- ---------------------------------------------------------------------------------------------------------------

create function public.token_workspace(p_token_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_token public.workspace_tokens;
begin
  select * into v_token from public.workspace_tokens t where t.token_hash = p_token_hash and t.revoked_at is null;
  if not found then
    raise exception 'invalid token' using errcode = '28000';
  end if;
  update public.workspace_tokens set last_used_at = now() where id = v_token.id;
  return v_token.workspace_id;
end;
$$;

create function public.pending_acceptances(p_token_hash text, p_n8n_workflow_id text)
returns table (id uuid, local_run text, case_ids text[], message text, accepted_by_email text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_workspace uuid := public.token_workspace(p_token_hash);
begin
  return query
    select a.id, a.local_run, a.case_ids, a.message, a.accepted_by_email, a.created_at
    from public.acceptances a join public.workflows w on w.id = a.workflow_id
    where a.workspace_id = v_workspace and w.n8n_workflow_id = p_n8n_workflow_id and a.applied_at is null
    order by a.created_at;
end;
$$;

create function public.mark_acceptance_applied(p_token_hash text, p_acceptance_id uuid, p_applied_cases text[], p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_token public.workspace_tokens;
begin
  select * into v_token from public.workspace_tokens t where t.token_hash = p_token_hash and t.revoked_at is null;
  if not found then
    raise exception 'invalid token' using errcode = '28000';
  end if;
  update public.acceptances a
    set applied_at = now(), applied_token_id = v_token.id, applied_cases = coalesce(p_applied_cases, array[]::text[]), applied_note = nullif(btrim(p_note), '')
    where a.id = p_acceptance_id and a.workspace_id = v_token.workspace_id and a.applied_at is null;
  return found;
end;
$$;

-- Addresses to email about one run: subscribed members of the run's organization whose statuses include it.
create function public.run_recipients(p_run_id uuid)
returns table (email text)
language sql stable security definer set search_path = '' as $$
  select distinct m.email
  from public.runs r
  join public.workspaces w on w.id = r.workspace_id
  join public.notification_subscriptions s on s.workspace_id = r.workspace_id and r.status = any (s.statuses)
  join public.members m on m.organization_id = w.organization_id and m.user_id = s.user_id
  where r.id = p_run_id and m.email <> '';
$$;

revoke all on function public.accept_run from public, anon;
grant execute on function public.accept_run to authenticated;
revoke all on function public.token_workspace, public.pending_acceptances, public.mark_acceptance_applied, public.run_recipients from public, anon, authenticated;
grant execute on function public.token_workspace, public.pending_acceptances, public.mark_acceptance_applied, public.run_recipients to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------------------------

alter table public.acceptances enable row level security;
alter table public.notification_subscriptions enable row level security;
alter table public.notification_log enable row level security;
revoke all on public.acceptances, public.notification_subscriptions, public.notification_log from anon, authenticated;

-- History is read-only for people; accept_run writes it and the runner marks it applied.
grant select on public.acceptances to authenticated;
create policy acceptances_select on public.acceptances for select to authenticated using (public.is_member(public.workspace_org(workspace_id)));

grant select, insert, delete on public.notification_subscriptions to authenticated;
grant update (statuses) on public.notification_subscriptions to authenticated;
create policy subscriptions_select on public.notification_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy subscriptions_insert on public.notification_subscriptions for insert to authenticated with check (user_id = (select auth.uid()) and public.is_member(public.workspace_org(workspace_id)));
create policy subscriptions_update on public.notification_subscriptions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.is_member(public.workspace_org(workspace_id)));
create policy subscriptions_delete on public.notification_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

-- notification_log: no grants for people; the service role reads and writes it.
