-- Week 13 of the paid layer: PDF export of a run, engine drift matrix v0, plan features for both.

-- Both come with Agency, as in the pricing hypothesis of the decision memo (point 6.9); one UPDATE moves them.
alter table public.plans
  add column pdf_export boolean not null default false,
  add column drift_matrix boolean not null default false;
update public.plans set pdf_export = true, drift_matrix = true where id = 'agency';

-- org_plan returns the two new features; a changed result type needs DROP. The functions that call it are plpgsql or
-- plain SQL bodies, which PostgreSQL does not track as dependents, so they pick up the new definition as they are.
drop function public.org_plan(uuid);

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
  uploads_last_day integer,
  pdf_export boolean,
  drift_matrix boolean
)
language sql stable security definer set search_path = '' as $$
  with account as (
    select b.plan, b.status, b.ended_at from public.billing_accounts b where b.organization_id = org
  ),
  current_plan as (
    select coalesce((select a.plan from account a where public.subscription_gives_plan(a.status) and a.plan is not null), 'free') as id
  ),
  -- 30 days after a paid plan ends, runs are still kept as long as that plan kept them.
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
      where w.organization_id = org and r.created_at > now() - interval '24 hours'),
    p.pdf_export,
    p.drift_matrix
  from public.plans p
  -- A signed-in caller sees only organizations they belong to; the service role and cron have no auth.uid().
  where p.id = (select c.id from current_plan c)
    and ((select auth.uid()) is null or public.is_member(org));
$$;

revoke all on function public.org_plan from public, anon;
grant execute on function public.org_plan to authenticated, service_role;

-- The engines an upgrade-check run compared, from the uploaded report (`upgrade`, added by `upgrade-check --upload`).
alter table public.runs
  add column engine_from text generated always as (case when mode = 'upgrade' then report -> 'upgrade' ->> 'engineOld' end) stored,
  add column engine_to text generated always as (case when mode = 'upgrade' then report -> 'upgrade' ->> 'engineNew' end) stored;
create index runs_upgrade_idx on public.runs (workspace_id, engine_to, workflow_id, created_at desc) where mode = 'upgrade';

-- The latest upgrade-check per workflow and target engine: one cell of the drift matrix. security_invoker keeps the
-- runs policies in force, so a member sees the cells of their own organizations only.
create view public.latest_upgrade_runs with (security_invoker = true) as
  select distinct on (r.workflow_id, r.engine_to)
    r.id, r.workspace_id, r.workflow_id, r.status, r.engine_from, r.engine_to, r.summary, r.created_at
  from public.runs r
  where r.mode = 'upgrade' and r.engine_to is not null
  order by r.workflow_id, r.engine_to, r.created_at desc;

revoke all on public.latest_upgrade_runs from anon, authenticated;
grant select on public.latest_upgrade_runs to authenticated;
