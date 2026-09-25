-- Fixes from the audit of week 14 (docs/audyt-tydzien-14-2026-09-25.md, ADR 0018). Numbers in the comments are the
-- items of the audit.

-- ---------------------------------------------------------------------------------------------------------------
-- 2, 22, 23. DPA acceptances are written by the server only. accept_dpa was open to every signed-in owner through
-- PostgREST, so the draft check and the version check of the app could be skipped. Each acceptance now also keeps
-- the provider's details and whether the text was a draft, so its PDF prints what the owner saw, not today's values.
-- ---------------------------------------------------------------------------------------------------------------

alter table public.dpa_acceptances
  add column provider jsonb check (provider is null or (jsonb_typeof(provider) = 'object' and provider ?& array['name', 'address', 'companyId', 'email'])),
  -- Rows from before this migration were all accepted while the texts were drafts.
  add column draft boolean not null default true;

drop function public.accept_dpa(uuid, text, text, text, text, text, text);

create function public.accept_dpa(
  p_user uuid,
  p_org uuid,
  p_version text,
  p_company_name text,
  p_company_address text,
  p_company_id text,
  p_signer_name text,
  p_signer_role text,
  p_provider jsonb,
  p_draft boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_id uuid;
begin
  if p_user is null or not exists (select 1 from public.members m where m.organization_id = p_org and m.user_id = p_user and m.role = 'owner') then
    raise exception 'only owners can accept the DPA for the organization' using errcode = '42501';
  end if;
  -- One acceptance at a time per organization: a double submit gets back the row the first one wrote.
  perform 1 from public.organizations o where o.id = p_org for update;
  select a.id into v_id from public.dpa_acceptances a
    where a.organization_id = p_org and a.version = p_version and a.accepted_by = p_user
      and a.company_name = btrim(p_company_name) and a.company_address = btrim(p_company_address)
      and a.company_id is not distinct from nullif(btrim(coalesce(p_company_id, '')), '')
      and a.signer_name = btrim(p_signer_name) and a.signer_role = btrim(p_signer_role)
      and a.provider is not distinct from p_provider and a.draft = p_draft;
  if v_id is not null then
    return v_id;
  end if;
  select u.email into v_email from auth.users u where u.id = p_user;
  insert into public.dpa_acceptances (organization_id, version, company_name, company_address, company_id, signer_name, signer_role, signer_email, accepted_by, provider, draft)
    values (p_org, p_version, btrim(p_company_name), btrim(p_company_address), nullif(btrim(coalesce(p_company_id, '')), ''), btrim(p_signer_name), btrim(p_signer_role), coalesce(v_email, ''), p_user, p_provider, p_draft)
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.accept_dpa from public, anon, authenticated;
grant execute on function public.accept_dpa to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 5, 19. Sub-processor notices. The announcement time is the database's, the notice period is 30 full days (a
-- change announced at 23:59 on day D takes effect on D+31 at the earliest), and a notice cannot be changed later or
-- deleted once an email about it went out: the page and the delivery log are the proof of what owners were told.
-- ---------------------------------------------------------------------------------------------------------------

create function public.valid_notice_changes(c jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(c) = 'array' and jsonb_array_length(c) between 1 and 20
    and not exists (
      select 1 from jsonb_array_elements(c) e(v)
      where jsonb_typeof(e.v) <> 'object'
        or coalesce(e.v ->> 'action', '') not in ('add', 'remove', 'change')
        or jsonb_typeof(e.v -> 'name') is distinct from 'string'
        or char_length(btrim(e.v ->> 'name')) not between 1 and 200
        or exists (select 1 from jsonb_each(e.v) f(k, x) where f.k in ('purpose', 'data', 'location') and (jsonb_typeof(f.x) <> 'string' or char_length(f.x #>> '{}') > 300))
    );
$$;

alter table public.subprocessor_notices
  drop constraint subprocessor_notices_check,
  drop constraint subprocessor_notices_changes_check,
  add constraint subprocessor_notices_notice_period check (effective_on >= (announced_at at time zone 'UTC')::date + 31),
  add constraint subprocessor_notices_changes_check check (public.valid_notice_changes(changes));

create function public.subprocessor_notices_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.announced_at := now();
    return new;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'an announced notice is not changed; announce a correction instead' using errcode = '55000';
  end if;
  if exists (select 1 from public.subprocessor_notice_deliveries d where d.notice_id = old.id and d.ok) then
    raise exception 'owners were emailed about this notice; it stays as proof of the notice' using errcode = '55000';
  end if;
  return old;
end;
$$;

create trigger subprocessor_notices_guard before insert or update or delete on public.subprocessor_notices
  for each row execute function public.subprocessor_notices_guard();

-- 6, 18, 20. Recipients are the owners of every organization (the DPA is part of the terms of each one), with the
-- address of their account where it is known, in a stable order so the sender can page through them.
create or replace function public.subprocessor_notice_recipients()
returns table (email text, organization_ids uuid[], organization_names text[])
language sql stable security definer set search_path = '' as $$
  select lower(coalesce(u.email, m.email)), array_agg(o.id order by o.name), array_agg(o.name order by o.name)
  from public.members m
  join public.organizations o on o.id = m.organization_id
  left join auth.users u on u.id = m.user_id
  where m.role = 'owner' and coalesce(u.email, m.email, '') <> ''
  group by lower(coalesce(u.email, m.email))
  order by 1;
$$;

-- 17. A sender claims an address before it emails it, so two runs at once do not both send. A claim older than
-- 15 minutes counts as a crashed run and may be taken again.
create function public.claim_notice_delivery(p_notice uuid, p_email text, p_organization_ids uuid[]) returns boolean
language sql security definer set search_path = '' as $$
  insert into public.subprocessor_notice_deliveries as d (notice_id, email, organization_ids, ok, detail, sent_at)
    values (p_notice, p_email, p_organization_ids, false, 'sending', now())
  on conflict (notice_id, email) do update set detail = 'sending', sent_at = now(), organization_ids = excluded.organization_ids
    where not d.ok and (d.detail is distinct from 'sending' or d.sent_at < now() - interval '15 minutes')
  returning true;
$$;

revoke all on function public.claim_notice_delivery from public, anon, authenticated;
grant execute on function public.claim_notice_delivery to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 21. An expired invitation stops counting at once: not a seat, not a pending invitation, and inviting the address
-- again replaces it instead of failing on the unique key until the nightly purge.
-- ---------------------------------------------------------------------------------------------------------------

create function public.invitations_replace_expired() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.invitations i
    where i.organization_id = new.organization_id and i.email = new.email and i.created_at <= now() - interval '30 days';
  return new;
end;
$$;

-- Named to run before invitations_limit, so the expired row does not count against the seats.
create trigger invitations_a_replace_expired before insert on public.invitations
  for each row execute function public.invitations_replace_expired();

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
      + (select count(*)::integer from public.invitations i where i.organization_id = org and i.created_at > now() - interval '30 days'),
    (select count(*)::integer from public.upload_events e where e.organization_id = org and e.at > now() - interval '24 hours'),
    p.pdf_export,
    p.drift_matrix
  from public.plans p
  -- A signed-in caller sees only organizations they belong to; the service role and cron have no auth.uid().
  where p.id = (select c.id from current_plan c)
    and ((select auth.uid()) is null or public.is_member(org));
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 30. The trial flag is set by the database whenever a subscription id is stored, whatever wrote it, and never
-- cleared: the path that forgets a deleted Stripe customer (lib/plan-change.ts) must not give a second trial.
-- ---------------------------------------------------------------------------------------------------------------

create function public.billing_accounts_first_subscription() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.first_subscription_at is not null then
    new.first_subscription_at := old.first_subscription_at;
  elsif new.stripe_subscription_id is not null and new.first_subscription_at is null then
    new.first_subscription_at := now();
  end if;
  return new;
end;
$$;

create trigger billing_accounts_first_subscription before insert or update on public.billing_accounts
  for each row execute function public.billing_accounts_first_subscription();

update public.billing_accounts set first_subscription_at = updated_at where stripe_subscription_id is not null and first_subscription_at is null;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. The sign-in log of the auth service keeps email addresses, also of deleted accounts; the nightly purge keeps
-- 30 days of it (listed at /legal/retention).
-- ---------------------------------------------------------------------------------------------------------------

create or replace function public.purge_expired_runs() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  delete from public.runs r
    using public.workspaces w, public.organizations o, lateral public.org_plan(w.organization_id) l
    where w.id = r.workspace_id and o.id = w.organization_id
      and r.created_at < now() - make_interval(days => least(l.retention_days, coalesce(o.retention_days, l.retention_days)));
  get diagnostics v_count = row_count;
  delete from public.invitations i where i.created_at < now() - interval '30 days';
  delete from public.stripe_events e where e.received_at < now() - interval '90 days';
  delete from public.sign_in_attempts a where a.at < now() - interval '1 day';
  delete from public.upload_events e where e.at < now() - interval '2 days';
  delete from public.subprocessor_notice_deliveries d
    using public.subprocessor_notices n
    where n.id = d.notice_id and n.effective_on < (now() at time zone 'UTC')::date - 365;
  -- The auth schema belongs to Supabase; should a project refuse this, the runs above are still deleted and the
  -- warning shows in the cron log (the check after deploying is in ADR 0018).
  begin
    delete from auth.audit_log_entries e where e.created_at < now() - interval '30 days';
  exception when insufficient_privilege then
    raise warning 'purge_expired_runs: cannot delete from auth.audit_log_entries: %', sqlerrm;
  end;
  return v_count;
end;
$$;
