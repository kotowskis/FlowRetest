-- Week 12 of the paid layer: plans (Free, Team 79 EUR, Agency 199 EUR), Stripe subscriptions per organization,
-- limits on workspaces, seats and uploads, retention of runs, invoices.
--
-- Stripe is the source of truth for what a customer pays; this schema keeps a copy that the webhook refreshes, so a
-- limit check never waits on the Stripe API. Every limit is enforced here, in the database, not only in the UI.

-- ---------------------------------------------------------------------------------------------------------------
-- Plans. Prices are what the pricing page shows; the amount charged comes from the Stripe price with the lookup key
-- flowretest_<plan>_<monthly|yearly> (scripts/stripe-setup.mjs creates them from this table's numbers).
-- ---------------------------------------------------------------------------------------------------------------

create table public.plans (
  id text primary key check (id in ('free', 'team', 'agency')),
  name text not null,
  price_month_cents integer not null,
  -- Paid yearly: twelve months minus 20%.
  price_year_cents integer not null,
  -- null means no limit.
  workspaces integer,
  -- Members plus pending invitations.
  seats integer not null,
  retention_days integer not null,
  -- Uploads per organization in any 24 hours; protects the service from a CI loop, not a pricing lever.
  uploads_per_day integer not null,
  -- GitHub checks and Slack messages.
  integrations boolean not null,
  sort integer not null
);

insert into public.plans (id, name, price_month_cents, price_year_cents, workspaces, seats, retention_days, uploads_per_day, integrations, sort) values
  ('free', 'Free', 0, 0, 1, 2, 14, 50, false, 0),
  ('team', 'Team', 7900, 75840, 10, 3, 90, 1000, true, 1),
  ('agency', 'Agency', 19900, 191040, null, 10, 365, 5000, true, 2);

-- The organization's Stripe customer and its subscription as the webhook last saw it. Written by the service role.
create table public.billing_accounts (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text unique,
  -- Plan of the subscription, kept after it ends: the retention grace period needs the last paid plan.
  plan text references public.plans (id),
  -- Stripe subscription status: active, trialing, past_due, unpaid, canceled, incomplete, incomplete_expired, paused.
  status text,
  billing_interval text check (billing_interval is null or billing_interval in ('month', 'year')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  -- When the subscription stopped giving the plan (status left active, trialing and past_due).
  ended_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.invoices (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text,
  status text not null,
  currency text not null,
  -- Minor units (cents), as Stripe sends them.
  total integer not null,
  amount_paid integer not null,
  amount_due integer not null,
  hosted_invoice_url text,
  invoice_pdf text,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null
);
create index invoices_org_created_idx on public.invoices (organization_id, created_at desc);

-- Stripe webhook deliveries, so a retried event is recognised and support can see what arrived.
create table public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  detail text
);

-- ---------------------------------------------------------------------------------------------------------------
-- The plan an organization has now, its limits and what it uses.
-- ---------------------------------------------------------------------------------------------------------------

-- past_due keeps the plan while Stripe retries the card; unpaid, canceled and the rest fall back to Free.
create function public.subscription_gives_plan(p_status text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_status in ('active', 'trialing', 'past_due'), false);
$$;

create function public.org_plan(org uuid)
returns table (
  plan text,
  workspaces integer,
  seats integer,
  retention_days integer,
  uploads_per_day integer,
  integrations boolean,
  workspaces_used integer,
  seats_used integer,
  uploads_last_day integer
)
language sql stable security definer set search_path = '' as $$
  with account as (
    select b.plan, b.status, b.ended_at from public.billing_accounts b where b.organization_id = org
  ),
  current_plan as (
    select coalesce((select a.plan from account a where public.subscription_gives_plan(a.status) and a.plan is not null), 'free') as id
  ),
  -- 30 days after a paid plan ends, runs are still kept as long as that plan kept them: a card that failed for
  -- good must not delete a year of history overnight.
  grace as (
    select p.retention_days from account a join public.plans p on p.id = a.plan
    where not public.subscription_gives_plan(a.status) and a.ended_at > now() - interval '30 days'
  )
  select
    p.id,
    p.workspaces,
    p.seats,
    greatest(p.retention_days, coalesce((select g.retention_days from grace g), 0)),
    p.uploads_per_day,
    p.integrations,
    (select count(*)::integer from public.workspaces w where w.organization_id = org),
    (select count(*)::integer from public.members m where m.organization_id = org)
      + (select count(*)::integer from public.invitations i where i.organization_id = org),
    (select count(*)::integer from public.runs r join public.workspaces w on w.id = r.workspace_id
      where w.organization_id = org and r.created_at > now() - interval '24 hours')
  from public.plans p
  -- A signed-in caller sees only organizations they belong to; the service role and cron have no auth.uid().
  where p.id = (select c.id from current_plan c)
    and ((select auth.uid()) is null or public.is_member(org));
$$;

-- Workspaces beyond the plan's limit, oldest first kept: after a downgrade the newest ones stop taking uploads.
create function public.workspace_over_limit(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(l.workspaces is not null and (
    select count(*) from public.workspaces o
    where o.organization_id = w.organization_id and (o.created_at, o.id) < (w.created_at, w.id)
  ) >= l.workspaces, false)
  from public.workspaces w, lateral public.org_plan(w.organization_id) l
  where w.id = ws;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Enforcement. 53400 (configuration_limit_exceeded) with the limit's name in HINT; the app turns it into a sentence
-- and the upload API into 402 or 429.
-- ---------------------------------------------------------------------------------------------------------------

create function public.enforce_workspace_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  l record;
begin
  -- Two workspaces created at the same moment must not both pass the count.
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text, 0));
  select * into l from public.org_plan(new.organization_id);
  if l.workspaces is not null and l.workspaces_used >= l.workspaces then
    raise exception 'The % plan includes % workspace%', initcap(l.plan), l.workspaces, case when l.workspaces = 1 then '' else 's' end
      using errcode = '53400', hint = 'workspaces';
  end if;
  return new;
end;
$$;

create trigger workspaces_limit before insert on public.workspaces
  for each row execute function public.enforce_workspace_limit();

create function public.enforce_seat_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  l record;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text, 0));
  select * into l from public.org_plan(new.organization_id);
  if l.seats_used >= l.seats then
    raise exception 'The % plan includes % seats, counting pending invitations', initcap(l.plan), l.seats
      using errcode = '53400', hint = 'seats';
  end if;
  return new;
end;
$$;

create trigger invitations_limit before insert on public.invitations
  for each row execute function public.enforce_seat_limit();

-- An organization that is still being charged cannot be deleted: its subscription would keep running in Stripe.
create function public.prevent_billed_org_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.billing_accounts b
    where b.organization_id = old.id and b.status in ('active', 'trialing', 'past_due', 'unpaid', 'incomplete') and not b.cancel_at_period_end
  ) then
    raise exception 'Cancel the subscription before deleting the organization' using errcode = '53400', hint = 'subscription';
  end if;
  return old;
end;
$$;

create trigger organizations_billed before delete on public.organizations
  for each row execute function public.prevent_billed_org_delete();

-- ingest_run from week 9, now with the upload and workspace limits checked in the same transaction as the write.
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
  update public.workspace_tokens set last_used_at = now() where id = v_token.id;
  return query select v_run, v_token.workspace_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Retention: runs older than the plan keeps them are deleted every night (checks and notification log go with them;
-- acceptances stay and lose the link to the run). Webhook deliveries are kept 90 days.
-- ---------------------------------------------------------------------------------------------------------------

create function public.purge_expired_runs() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  delete from public.runs r
    using public.workspaces w, lateral public.org_plan(w.organization_id) l
    where w.id = r.workspace_id and r.created_at < now() - make_interval(days => l.retention_days);
  get diagnostics v_count = row_count;
  delete from public.stripe_events e where e.received_at < now() - interval '90 days';
  return v_count;
end;
$$;

create extension if not exists pg_cron;
select cron.schedule('flowretest-purge-expired-runs', '17 3 * * *', 'select public.purge_expired_runs()');

-- ---------------------------------------------------------------------------------------------------------------
-- Grants and row level security
-- ---------------------------------------------------------------------------------------------------------------

revoke all on function public.org_plan, public.workspace_over_limit from public, anon;
grant execute on function public.org_plan, public.workspace_over_limit to authenticated, service_role;
revoke all on function public.purge_expired_runs from public, anon, authenticated;
grant execute on function public.purge_expired_runs to service_role;
revoke all on function public.enforce_workspace_limit, public.enforce_seat_limit, public.prevent_billed_org_delete from public, anon, authenticated;

alter table public.plans enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.invoices enable row level security;
alter table public.stripe_events enable row level security;
revoke all on public.plans, public.billing_accounts, public.invoices, public.stripe_events from anon, authenticated;

grant select on public.plans to anon, authenticated;
create policy plans_select on public.plans for select to anon, authenticated using (true);

-- Every member sees the plan; the Stripe ids stay with the service role.
grant select (organization_id, plan, status, billing_interval, current_period_end, cancel_at_period_end, ended_at, updated_at) on public.billing_accounts to authenticated;
create policy billing_accounts_select on public.billing_accounts for select to authenticated using (public.is_member(organization_id));

-- Invoices carry the agency's billing details: owners only.
grant select on public.invoices to authenticated;
create policy invoices_select on public.invoices for select to authenticated using (public.is_owner(organization_id));

-- stripe_events: no grants for people.
