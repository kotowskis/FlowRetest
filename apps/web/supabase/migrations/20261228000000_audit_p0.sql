-- Fixes of the P0 findings in docs/audyt-2026-09-25.md that live in the database.

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Accounts are passwordless: people sign in with the emailed code or link. The password sign-up endpoint of
-- Supabase Auth stays public, and with email autoconfirm anyone could register an invitee's address with a password,
-- sign in and claim the invitation, or register an address before its owner and keep the password. Refusing every
-- session that a password opened closes both, whatever the auth settings of the project are. GoTrue records how each
-- session was opened in auth.mfa_amr_claims ('password', 'otp', 'magiclink', ...), inside the sign-in transaction.
-- ---------------------------------------------------------------------------------------------------------------

create function public.refuse_password_sessions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.authentication_method = 'password' then
    raise exception 'FlowRetest accounts sign in with an emailed code, not a password' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.refuse_password_sessions from public, anon, authenticated;

create trigger mfa_amr_claims_no_password before insert on auth.mfa_amr_claims
  for each row execute function public.refuse_password_sessions();

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Revoking a token is final: a member may revoke, nobody may bring a revoked token back.
-- ---------------------------------------------------------------------------------------------------------------

create function public.keep_token_revoked() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'A revoked token stays revoked; create a new one' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.keep_token_revoked from public, anon, authenticated;

create trigger workspace_tokens_revoked before update on public.workspace_tokens
  for each row execute function public.keep_token_revoked();

-- ---------------------------------------------------------------------------------------------------------------
-- 1. The server posts to every stored Slack webhook, so only the server may store one: the app checks the host
-- (hooks.slack.com) and the owner, then inserts with the service role. sendSlack checks the host again.
-- ---------------------------------------------------------------------------------------------------------------

drop policy slack_webhooks_insert on public.slack_webhooks;
revoke insert on public.slack_webhooks from authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. A check is posted only on a repository the linking person administers. The setup route stores those
-- repositories (owner/name, lower case); installations linked before this migration have none and post nothing
-- until an owner links them again.
-- ---------------------------------------------------------------------------------------------------------------

alter table public.github_installations add column repositories text[] not null default '{}';

-- ---------------------------------------------------------------------------------------------------------------
-- 6 and 8. billing_accounts remembers the plan before the last change. A move to a smaller paid plan keeps the
-- retention of the previous one for 30 days, as a subscription that ended does; a live subscription whose price
-- has no known plan keeps the plan it had instead of falling back to Free.
-- ---------------------------------------------------------------------------------------------------------------

alter table public.billing_accounts
  add column previous_plan text references public.plans (id),
  add column plan_changed_at timestamptz;

create function public.track_plan_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.plan is null and old.plan is not null and public.subscription_gives_plan(new.status) then
    new.plan := old.plan;
  end if;
  if new.plan is distinct from old.plan and old.plan is not null and public.subscription_gives_plan(old.status) then
    new.previous_plan := old.plan;
    new.plan_changed_at := now();
  end if;
  -- The grace period counts from the moment the plan stopped, not from the latest sync of a subscription that stays
  -- unpaid or paused (Stripe sets no ended_at for those, so every sync would move it forward).
  if not public.subscription_gives_plan(new.status) and not public.subscription_gives_plan(old.status) and old.ended_at is not null then
    new.ended_at := old.ended_at;
  end if;
  return new;
end;
$$;

revoke all on function public.track_plan_change from public, anon, authenticated;

create trigger billing_accounts_plan_change before update on public.billing_accounts
  for each row execute function public.track_plan_change();

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
  grace as (
    select p.retention_days from account a join public.plans p on p.id = a.plan
    where not public.subscription_gives_plan(a.status) and a.ended_at > now() - interval '30 days'
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
    (select count(*)::integer from public.runs r join public.workspaces w on w.id = r.workspace_id
      where w.organization_id = org and r.created_at > now() - interval '24 hours'),
    p.pdf_export,
    p.drift_matrix
  from public.plans p
  -- A signed-in caller sees only organizations they belong to; the service role and cron have no auth.uid().
  where p.id = (select c.id from current_plan c)
    and ((select auth.uid()) is null or public.is_member(org));
$$;
