-- Week 14 of the paid layer (plan section 11): the data processing agreement and the retention policy.
--
-- The policy published at /legal/retention is enforced here, not in the app: a shorter run history an owner may
-- choose, invitations that expire, and a record of who accepted which version of the DPA for the organization.
-- (Every organization keeps an owner since 20261229000000_audit_p1.sql, so one can always export or delete it.)

-- ---------------------------------------------------------------------------------------------------------------
-- Run history chosen by the organization. null keeps the plan's; a value above the plan's changes nothing, because
-- purge_expired_runs takes the shorter of the two. Agencies whose customer contracts allow 30 days set 30 here.
-- ---------------------------------------------------------------------------------------------------------------

alter table public.organizations add column retention_days integer check (retention_days is null or retention_days between 1 and 3650);
grant update (retention_days) on public.organizations to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- DPA acceptances. One row per acceptance and version; rows are never changed, a new version is a new row.
-- The signer's email comes from the session, not from the form.
-- ---------------------------------------------------------------------------------------------------------------

create table public.dpa_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  version text not null check (version ~ '^\d{4}-\d{2}-\d{2}$'),
  company_name text not null check (char_length(btrim(company_name)) between 1 and 200),
  company_address text not null check (char_length(btrim(company_address)) between 1 and 500),
  company_id text check (company_id is null or char_length(company_id) <= 100),
  signer_name text not null check (char_length(btrim(signer_name)) between 1 and 200),
  signer_role text not null check (char_length(btrim(signer_role)) between 1 and 200),
  signer_email text not null,
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz not null default now()
);
create index dpa_acceptances_org_idx on public.dpa_acceptances (organization_id, accepted_at desc);

alter table public.dpa_acceptances enable row level security;
revoke all on public.dpa_acceptances from anon, authenticated;
grant select on public.dpa_acceptances to authenticated;
create policy dpa_acceptances_select on public.dpa_acceptances for select to authenticated using (public.is_member(organization_id));

create or replace function public.accept_dpa(
  p_org uuid,
  p_version text,
  p_company_name text,
  p_company_address text,
  p_company_id text,
  p_signer_name text,
  p_signer_role text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_id uuid;
begin
  if v_user is null or not public.is_owner(p_org) then
    raise exception 'only owners can accept the DPA for the organization' using errcode = '42501';
  end if;
  select u.email into v_email from auth.users u where u.id = v_user;
  insert into public.dpa_acceptances (organization_id, version, company_name, company_address, company_id, signer_name, signer_role, signer_email, accepted_by)
    values (p_org, p_version, btrim(p_company_name), btrim(p_company_address), nullif(btrim(coalesce(p_company_id, '')), ''), btrim(p_signer_name), btrim(p_signer_role), coalesce(v_email, ''), v_user)
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.accept_dpa from public, anon;
grant execute on function public.accept_dpa to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Invitations expire after 30 days: they hold the address of somebody who never signed up.
-- ---------------------------------------------------------------------------------------------------------------

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
    select i.organization_id, v_user, v_email, i.role from public.invitations i
    where i.email = v_email and i.created_at > now() - interval '30 days'
    on conflict (organization_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  delete from public.invitations i where i.email = v_email;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- The nightly purge: runs past the shorter of the plan's and the organization's history (the plan's includes the
-- 30 days of grace), expired invitations, and the service's own short-lived records.
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
  return v_count;
end;
$$;
