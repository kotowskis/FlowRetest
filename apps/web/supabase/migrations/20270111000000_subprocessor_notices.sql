-- Notices of sub-processor changes (DPA section 6, ADR 0016): a change is announced at least 30 days before it takes
-- effect, shown on /legal/subprocessors and emailed to the owners of every organization that accepted the DPA.
-- Notices are public; who got which email is kept for the service only.

create table public.subprocessor_notices (
  id uuid primary key default gen_random_uuid(),
  announced_at timestamptz not null default now(),
  effective_on date not null,
  summary text not null check (char_length(btrim(summary)) between 1 and 2000),
  -- [{"action": "add" | "remove" | "change", "name": ..., "purpose": ..., "data": ..., "location": ...}]
  changes jsonb not null check (jsonb_typeof(changes) = 'array' and jsonb_array_length(changes) between 1 and 20),
  -- The objection period of the DPA: 30 full days between the announcement and the change.
  check (effective_on >= (announced_at at time zone 'UTC')::date + 30)
);
create index subprocessor_notices_effective_idx on public.subprocessor_notices (effective_on desc);

alter table public.subprocessor_notices enable row level security;
revoke all on public.subprocessor_notices from anon, authenticated;
grant select on public.subprocessor_notices to anon, authenticated;
create policy subprocessor_notices_select on public.subprocessor_notices for select to anon, authenticated using (true);

-- One row per notice and address; a person who owns several organizations gets one email naming all of them.
-- A failed send stays ok = false and is retried by the next run of the sending script.
create table public.subprocessor_notice_deliveries (
  notice_id uuid not null references public.subprocessor_notices (id) on delete cascade,
  email text not null,
  organization_ids uuid[] not null,
  ok boolean not null,
  detail text check (detail is null or char_length(detail) <= 500),
  sent_at timestamptz not null default now(),
  primary key (notice_id, email)
);

alter table public.subprocessor_notice_deliveries enable row level security;
revoke all on public.subprocessor_notice_deliveries from anon, authenticated;

-- Owners of organizations with at least one DPA acceptance, with the names of those organizations.
create or replace function public.subprocessor_notice_recipients()
returns table (email text, organization_ids uuid[], organization_names text[])
language sql stable security definer set search_path = '' as $$
  select lower(m.email), array_agg(o.id order by o.name), array_agg(o.name order by o.name)
  from public.members m
  join public.organizations o on o.id = m.organization_id
  where m.role = 'owner' and m.email <> ''
    and exists (select 1 from public.dpa_acceptances a where a.organization_id = o.id)
  group by lower(m.email);
$$;

revoke all on function public.subprocessor_notice_recipients from public, anon, authenticated;
grant execute on function public.subprocessor_notice_recipients to service_role;

-- The nightly purge also drops the delivery log a year after the change took effect (it holds owners' addresses);
-- the notices themselves stay public as the history of the list.
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
  return v_count;
end;
$$;
