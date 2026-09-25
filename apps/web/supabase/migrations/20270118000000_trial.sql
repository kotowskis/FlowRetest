-- Free trial of the paid plans (ADR 0017). Checkout starts a subscription in the trialing status, which already gives
-- the plan (subscription_gives_plan); the database keeps when the trial ends and whether the organization ever had a
-- subscription, because a trial is offered only once per organization.

alter table public.billing_accounts
  add column trial_end timestamptz,
  add column first_subscription_at timestamptz;

grant select (trial_end, first_subscription_at) on public.billing_accounts to authenticated;

-- Organizations that already had a subscription used their chance before trials existed.
update public.billing_accounts set first_subscription_at = updated_at where stripe_subscription_id is not null and first_subscription_at is null;
