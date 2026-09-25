import type { Metadata } from 'next';
import { getBilling, type PlanLimits } from '@/lib/data.ts';
import { planFeatures } from '@/lib/plans.ts';
import { syncCheckout } from '@/lib/billing.ts';
import { stripeConfig } from '@/lib/stripe.ts';
import { trialFor } from '@/lib/plan-change.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';
import { PlanChoice } from '@/components/forms.tsx';
import { Empty, PageHeader, Section, Time, money, quietButtonClass } from '@/components/ui.tsx';
import { choosePlan, openBillingPortal } from './actions.ts';

export const metadata: Metadata = { title: 'Billing' };

function Usage({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const over = limit !== null && used > limit;
  const full = limit !== null && used >= limit;
  return (
    <div className="rounded-md border border-line bg-panel px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 font-mono text-lg ${over ? 'text-error' : full ? 'text-diff' : ''}`}>
        {used}
        <span className="text-sm text-muted"> / {limit === null ? 'no limit' : limit}</span>
      </div>
    </div>
  );
}

function statusLine(account: { status: string | null; current_period_end: string | null; cancel_at_period_end: boolean; cancel_at: string | null; ended_at: string | null; trial_end: string | null } | undefined, limits: PlanLimits, price: string | undefined) {
  if (!account?.status) return null;
  if (account.status === 'past_due') return <p className="text-sm text-diff">The last payment failed. Stripe retries the card; update it in the payment details to keep the plan.</p>;
  if (account.status === 'unpaid' || account.status === 'paused' || account.status === 'incomplete') return <p className="text-sm text-diff">The subscription is {account.status}. Pay the open invoice or update the card in the payment details to get the plan back.</p>;
  // In flexible billing mode the portal sets cancel_at only; in classic mode cancel_at_period_end.
  const ends = account.cancel_at ?? (account.cancel_at_period_end ? account.current_period_end : null);
  if (ends) return <p className="text-sm text-diff">Cancelled. The plan ends on <Time value={ends} />, then the organization moves to Free.</p>;
  if (account.status === 'trialing' && account.trial_end) {
    return (
      <p className="text-sm text-muted">
        Free trial until <Time value={account.trial_end} />. Then the card is charged{price ? ` ${price}` : ''} unless you cancel in the payment details before that day.
      </p>
    );
  }
  if ((account.status === 'active' || account.status === 'trialing') && account.current_period_end) return <p className="text-sm text-muted">Renews on <Time value={account.current_period_end} />.</p>;
  if (account.ended_at && limits.plan === 'free') return <p className="text-sm text-muted">The paid plan ended on <Time value={account.ended_at} />. Runs are kept as long as that plan kept them for 30 days after it ended.</p>;
  return null;
}

const CHECKOUT_MESSAGES: Record<string, { text: string; ok?: boolean }> = {
  success: { text: 'Done. The plan applies to this organization now; invoices are below and in your email.', ok: true },
  pending: { text: 'Stripe has not confirmed the payment yet. This page shows the plan as soon as the confirmation arrives.' },
  cancelled: { text: 'Checkout was cancelled; nothing was charged.' },
};

const PORTAL_MESSAGES: Record<string, string> = {
  unavailable: 'The Stripe portal did not open. Try again in a minute; invoices are also in your email.',
};

export default async function BillingPage({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ checkout?: string; session_id?: string; portal?: string }> }) {
  const { orgId } = await params;
  const { checkout, session_id: sessionId, portal } = await searchParams;
  const config = stripeConfig();
  // Membership first (getBilling reads through RLS and 404s for others): nobody else makes this server call Stripe.
  let billing = await getBilling(orgId);
  let checkoutState = checkout;
  if (checkout === 'success' && sessionId && config) {
    // Do not wait for the webhook: read the session and apply the subscription now.
    const applied = await syncCheckout(createAdminClient(), config, orgId, sessionId).catch(() => false);
    if (applied) billing = await getBilling(orgId);
    else checkoutState = 'pending';
  }
  const { org, plans, account, invoices, isOwner, limits } = billing;
  const message = checkoutState ? CHECKOUT_MESSAGES[checkoutState] : portal && PORTAL_MESSAGES[portal] ? { text: PORTAL_MESSAGES[portal] } : undefined;
  const current = plans.find((p) => p.id === limits.plan);
  const livePaid = limits.plan !== 'free' && account?.billing_interval;
  // An organization that never had a subscription starts its first paid plan with a free trial.
  const trial = config ? trialFor(config, account) : 0;
  const currentPrice = current && account?.billing_interval ? (account.billing_interval === 'year' ? `${money(current.price_year_cents)} a year` : `${money(current.price_month_cents)} a month`) : undefined;

  return (
    <>
      <PageHeader crumbs={[{ label: 'Organizations', href: '/orgs' }, { label: org.name, href: `/o/${org.id}` }, { label: 'Billing' }]} title="Billing" />
      {message ? <p role="status" className={`mb-6 text-sm ${message.ok ? 'text-pass' : 'text-diff'}`}>{message.text}</p> : null}

      <Section title={`Current plan: ${current?.name ?? limits.plan}`}>
        {statusLine(account, limits, currentPrice)}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Usage label="Workspaces" used={limits.workspaces_used} limit={limits.workspaces} />
          <Usage label="Seats (incl. invitations)" used={limits.seats_used} limit={limits.seats} />
          <Usage label="Uploads, last 24 hours" used={limits.uploads_last_day} limit={limits.uploads_per_day} />
          <div className="rounded-md border border-line bg-panel px-4 py-3">
            <div className="text-xs text-muted">Run history</div>
            <div className="mt-1 font-mono text-lg">{limits.retention_days}<span className="text-sm text-muted"> days</span></div>
          </div>
        </div>
        {limits.workspaces !== null && limits.workspaces_used > limits.workspaces ? (
          <p className="mt-3 text-sm text-error">
            This organization has more workspaces than the plan includes. Uploads go to the {limits.workspaces} oldest; the newer ones refuse them until you upgrade or delete workspaces.
          </p>
        ) : null}
        <p className="mt-3 text-sm text-muted">Runs older than the history period are deleted every night. Accepted baselines stay on the machines that ran them.</p>
        {isOwner && account && config ? (
          <form action={openBillingPortal} className="mt-4">
            <input type="hidden" name="orgId" value={org.id} />
            <button className={quietButtonClass}>Payment details, VAT id and cancelling (Stripe)</button>
          </form>
        ) : null}
      </Section>

      <Section
        title="Plans"
        description={`Prices without VAT. Yearly billing costs 20% less than twelve months.${trial ? ` Your first paid plan starts with ${trial} days free: Stripe asks for a card and charges it only when the trial ends, so cancelling before then costs nothing.` : ''} The runner and everything that stays on your machines are free and open source.`}
      >
        {!config ? <p className="mb-4 text-sm text-diff">This server does not take payments yet.</p> : null}
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((p) => {
            const isCurrent = p.id === limits.plan;
            return (
              <div key={p.id} className={`flex flex-col rounded-md border bg-panel p-4 ${isCurrent ? 'border-accent' : 'border-line'}`}>
                <h3 className="font-semibold">{p.name}</h3>
                <p className="mt-1 font-mono text-sm">
                  {p.price_month_cents === 0 ? 'free' : <>{money(p.price_month_cents)} / month<span className="block text-xs text-muted">or {money(p.price_year_cents)} / year</span></>}
                </p>
                <ul className="mt-3 flex-1 space-y-1 text-sm text-muted">
                  {planFeatures(p).map((f) => <li key={f}>{f}</li>)}
                </ul>
                <div className="mt-4">
                  {p.id === 'free' ? (
                    isCurrent ? <p className="text-sm text-muted">Current plan</p> : isOwner && config ? <p className="text-xs text-muted">Cancel in the payment details to return to Free at the end of the period.</p> : null
                  ) : isOwner && config ? (
                    <PlanChoice
                      action={choosePlan}
                      orgId={org.id}
                      plan={p.id}
                      options={[
                        { interval: 'month', label: trial ? `Try ${p.name} free for ${trial} days, then monthly` : `${livePaid ? 'Switch to' : 'Choose'} ${p.name} monthly`, current: isCurrent && account?.billing_interval === 'month' },
                        { interval: 'year', label: trial ? `Try ${p.name} free for ${trial} days, then yearly` : `${livePaid ? 'Switch to' : 'Choose'} ${p.name} yearly`, current: isCurrent && account?.billing_interval === 'year' },
                      ]}
                    />
                  ) : isCurrent ? (
                    <p className="text-sm text-muted">Current plan</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {!isOwner ? <p className="mt-4 text-sm text-muted">Only owners of this organization can change the plan.</p> : null}
      </Section>

      {isOwner ? (
        <Section title="Invoices" description="Stripe emails every invoice to the billing address as well.">
          {invoices.length === 0 ? (
            <Empty>No invoices yet.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-md border border-line bg-panel">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Number</th>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Total</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium"><span className="sr-only">Links</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <td className="px-4 py-2 font-mono text-xs">{i.number ?? i.id}</td>
                      <td className="px-4 py-2 text-muted"><Time value={i.created_at} /></td>
                      <td className="px-4 py-2 font-mono text-xs">{money(i.total, i.currency)}</td>
                      <td className={`px-4 py-2 text-xs ${i.status === 'paid' ? 'text-pass' : i.status === 'open' ? 'text-diff' : 'text-muted'}`}>{i.status}</td>
                      <td className="px-4 py-2 text-right text-xs whitespace-nowrap">
                        {i.invoice_pdf ? <a href={i.invoice_pdf} className="hover:underline">PDF</a> : null}
                        {i.hosted_invoice_url ? <a href={i.hosted_invoice_url} className="ml-3 hover:underline">{i.status === 'open' ? 'Pay' : 'View'}</a> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      ) : null}
    </>
  );
}
