/**
 * Stripe client for billing: customers, Checkout, the customer portal, subscriptions, invoices and webhook signatures.
 * Plain fetch with form-encoded bodies and a pinned API version; the base URL is configurable so tests and local
 * development run against scripts/fake-services.mjs.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Pinned so a change of the account's default version cannot move fields (basil moved billing periods to items). */
export const STRIPE_API_VERSION = '2026-02-25.clover';

export type PaidPlan = 'team' | 'agency';
export type Interval = 'month' | 'year';

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  apiUrl: string;
  /** Stripe Tax on Checkout; needs tax registrations in the Stripe account first. */
  automaticTax: boolean;
  /**
   * A live key without an explicit STRIPE_AUTOMATIC_TAX. The pages say prices exclude VAT, so a live Checkout without
   * a decision about VAT is refused instead of issuing invoices with none (audit of week 14, item 10).
   */
  taxUndecided?: boolean;
  /** Days of free trial for an organization's first subscription; 0 turns trials off. */
  trialDays: number;
}

export interface StripeEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_API_URL?: string;
  STRIPE_AUTOMATIC_TAX?: string;
  STRIPE_TRIAL_DAYS?: string;
}

export const DEFAULT_TRIAL_DAYS = 14;

/**
 * Trial length from STRIPE_TRIAL_DAYS (0 to 90, Stripe allows up to 730), 14 when unset or not a whole number in that
 * range. Read without the Stripe keys so the public pricing page can say it.
 */
export function trialDays(env: StripeEnv = process.env as StripeEnv): number {
  const raw = env.STRIPE_TRIAL_DAYS?.trim();
  if (!raw) return DEFAULT_TRIAL_DAYS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 90 ? n : DEFAULT_TRIAL_DAYS;
}

/** Billing settings, or undefined when this server takes no payments (the billing page says so). */
export function stripeConfig(env: StripeEnv = process.env as StripeEnv): StripeConfig | undefined {
  const { STRIPE_SECRET_KEY: secretKey, STRIPE_WEBHOOK_SECRET: webhookSecret } = env;
  if (!secretKey || !webhookSecret) return undefined;
  return {
    secretKey,
    webhookSecret,
    apiUrl: (env.STRIPE_API_URL || 'https://api.stripe.com').replace(/\/+$/, ''),
    automaticTax: env.STRIPE_AUTOMATIC_TAX === 'true',
    taxUndecided: /^[rs]k_live_/.test(secretKey) && !['true', 'false'].includes(env.STRIPE_AUTOMATIC_TAX ?? ''),
    trialDays: trialDays(env),
  };
}

/** Lookup key of the Stripe price for a plan and interval; scripts/stripe-setup.mjs creates prices with these keys. */
export function lookupKey(plan: PaidPlan, interval: Interval): string {
  return `flowretest_${plan}_${interval === 'month' ? 'monthly' : 'yearly'}`;
}

export function parseLookupKey(key: string | null | undefined): { plan: PaidPlan; interval: Interval } | undefined {
  const m = /^flowretest_(team|agency)_(monthly|yearly)$/.exec(key ?? '');
  if (!m) return undefined;
  return { plan: m[1] as PaidPlan, interval: m[2] === 'monthly' ? 'month' : 'year' };
}

type Params = { [key: string]: string | number | boolean | undefined | null | Params | Array<string | Params> };

/** Stripe's bracket notation: {a: {b: 1}, c: [x]} becomes a[b]=1&c[0]=x. */
export function formEncode(params: Params): string {
  const out = new URLSearchParams();
  const walk = (value: unknown, key: string) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${key}[${i}]`));
    else if (typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, key ? `${key}[${k}]` : k);
    else out.append(key, String(value));
  };
  walk(params, '');
  return out.toString();
}

export class StripeError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'StripeError';
    this.status = status;
    this.code = code;
  }
}

async function call<T>(config: StripeConfig, method: 'GET' | 'POST', path: string, params?: Params, idempotencyKey?: string): Promise<T> {
  const query = method === 'GET' && params ? `?${formEncode(params)}` : '';
  const res = await fetch(`${config.apiUrl}${path}${query}`, {
    method,
    headers: {
      authorization: `Bearer ${config.secretKey}`,
      'stripe-version': STRIPE_API_VERSION,
      ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: method === 'POST' ? formEncode(params ?? {}) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: { error?: { message?: string; code?: string } } & Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON; the status says enough.
  }
  if (!res.ok) throw new StripeError(res.status, `Stripe ${method} ${path} answered ${res.status}: ${json.error?.message ?? text.slice(0, 200)}`, json.error?.code);
  return json as T;
}

export interface StripeCustomer {
  id: string;
}

export interface StripePrice {
  id: string;
  lookup_key: string | null;
  unit_amount: number | null;
  currency: string;
  recurring: { interval: string } | null;
  /** `flowretest_plan`: set by scripts/stripe-setup.mjs on every price it creates. */
  metadata?: Record<string, string>;
}

/**
 * The plan and interval a price stands for. The price's metadata comes first: a new price created with
 * `transfer_lookup_key` takes the lookup key away from the old one, and subscribers who still pay the old price must
 * keep their plan. The lookup key is the fallback for prices created before the metadata existed.
 */
export function planOfPrice(price: StripePrice | undefined): { plan: PaidPlan; interval: Interval } | undefined {
  if (!price) return undefined;
  const plan = price.metadata?.flowretest_plan;
  const interval = price.recurring?.interval;
  if ((plan === 'team' || plan === 'agency') && (interval === 'month' || interval === 'year')) return { plan, interval };
  return parseLookupKey(price.lookup_key);
}

export interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  /** Set when the subscription is scheduled to end; in flexible billing mode the portal sets this instead of cancel_at_period_end. */
  cancel_at?: number | null;
  ended_at: number | null;
  canceled_at: number | null;
  metadata: Record<string, string>;
  /** End of the free trial (seconds), null without one. */
  trial_end?: number | null;
  items: { data: Array<{ id: string; current_period_end: number; price: StripePrice }> };
  /** Set while a plan change waits for its invoice to be paid (payment_behavior=pending_if_incomplete). */
  pending_update?: { expires_at: number } | null;
}

export interface StripeInvoice {
  id: string;
  customer: string;
  number: string | null;
  status: string | null;
  currency: string;
  total: number;
  amount_paid: number;
  amount_due: number;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  period_start: number | null;
  period_end: number | null;
  created: number;
}

export interface CheckoutSession {
  id: string;
  url: string | null;
  customer: string | null;
  subscription: string | null;
  status: string | null;
  client_reference_id: string | null;
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: { id?: string; object?: string; customer?: string | null; subscription?: string | null } };
}

export function createCustomer(config: StripeConfig, input: { organizationId: string; name: string; email: string; attempt?: string }): Promise<StripeCustomer> {
  // The idempotency key stops a double click from creating two customers for one organization (Stripe keeps keys 24 h).
  // It covers the email too: Stripe refuses a key reused with other parameters, so two owners clicking at once would
  // otherwise get an error; with the email in the key the second gets its own customer and the database keeps one.
  const who = createHash('sha256').update(input.email).digest('hex').slice(0, 12);
  return call(config, 'POST', '/v1/customers', { name: input.name, email: input.email, metadata: { organization_id: input.organizationId } }, `frt-customer-${input.organizationId}-${who}${input.attempt ? `-${input.attempt}` : ''}`);
}

export async function priceFor(config: StripeConfig, plan: PaidPlan, interval: Interval): Promise<StripePrice> {
  const key = lookupKey(plan, interval);
  const list = await call<{ data: StripePrice[] }>(config, 'GET', '/v1/prices', { lookup_keys: [key], active: true, limit: 1 });
  const price = list.data[0];
  if (!price) throw new StripeError(404, `no active Stripe price with lookup key ${key}; run scripts/stripe-setup.mjs`);
  return price;
}

export function createCheckoutSession(
  config: StripeConfig,
  input: { customer: string; price: string; organizationId: string; successUrl: string; cancelUrl: string; trialDays?: number },
  // A double click within ten seconds gets the same Checkout page instead of a second one.
  idempotencyKey = `frt-checkout-${input.organizationId}-${input.price}-${Math.floor(Date.now() / 10_000)}`,
): Promise<CheckoutSession> {
  if (config.taxUndecided) {
    return Promise.reject(new StripeError(500, 'STRIPE_AUTOMATIC_TAX is not set for a live Stripe key: set it to true once Stripe Tax has the VAT registrations, or to false for a provider that charges no VAT (and change the pages that say prices exclude VAT)'));
  }
  return call(config, 'POST', '/v1/checkout/sessions', {
    mode: 'subscription',
    customer: input.customer,
    client_reference_id: input.organizationId,
    line_items: [{ price: input.price, quantity: '1' }],
    subscription_data: {
      metadata: { organization_id: input.organizationId },
      // The trial asks for a card like a paid start (payment_method_collection=always); should a subscription lose
      // its payment method, it ends with the trial instead of turning into an unpaid invoice.
      ...(input.trialDays ? { trial_period_days: input.trialDays, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } } : {}),
    },
    payment_method_collection: 'always',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    // Agencies are businesses: a VAT id on the invoice lets EU customers use reverse charge.
    tax_id_collection: { enabled: true },
    customer_update: { name: 'auto', address: 'auto' },
    automatic_tax: config.automaticTax ? { enabled: true } : undefined,
  }, idempotencyKey);
}

export function getCheckoutSession(config: StripeConfig, id: string): Promise<CheckoutSession> {
  return call(config, 'GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`);
}

export function createPortalSession(config: StripeConfig, input: { customer: string; returnUrl: string }): Promise<{ url: string }> {
  return call(config, 'POST', '/v1/billing_portal/sessions', { customer: input.customer, return_url: input.returnUrl });
}

export function getSubscription(config: StripeConfig, id: string): Promise<StripeSubscription> {
  return call(config, 'GET', `/v1/subscriptions/${encodeURIComponent(id)}`);
}

/**
 * Moves the subscription to another price and bills the prorated difference at once. With `pending_if_incomplete`
 * the new price takes effect only when that invoice is paid; until then Stripe keeps the old price and the returned
 * subscription has `pending_update`. A move to a smaller plan gives a credit on the customer's balance.
 */
export function changeSubscriptionPrice(config: StripeConfig, subscription: StripeSubscription, price: string): Promise<StripeSubscription> {
  const item = subscription.items.data[0];
  if (!item) throw new StripeError(409, `subscription ${subscription.id} has no items`);
  return call(config, 'POST', `/v1/subscriptions/${encodeURIComponent(subscription.id)}`, {
    items: [{ id: item.id, price }],
    proration_behavior: 'always_invoice',
    payment_behavior: 'pending_if_incomplete',
  });
}

/** The customer's subscriptions in any status, newest first; finds a live one when the tracked one ended. */
export async function listSubscriptions(config: StripeConfig, customer: string): Promise<StripeSubscription[]> {
  const list = await call<{ data: StripeSubscription[] }>(config, 'GET', '/v1/subscriptions', { customer, status: 'all', limit: 20 });
  return list.data;
}

export function getInvoice(config: StripeConfig, id: string): Promise<StripeInvoice> {
  return call(config, 'GET', `/v1/invoices/${encodeURIComponent(id)}`);
}

/**
 * What the database keeps of a subscription. The plan comes from the price Stripe charges (`planOfPrice`), never from
 * the subscription's metadata, which stays stale after a change in the portal.
 */
export interface SubscriptionState {
  plan: PaidPlan | null;
  interval: Interval | null;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** When a scheduled cancellation ends the subscription, whichever way it was scheduled. */
  cancelAt: string | null;
  endedAt: string | null;
  /** End of the free trial while the subscription is trialing; null otherwise. */
  trialEnd: string | null;
}

const iso = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : null);

export function subscriptionState(sub: StripeSubscription): SubscriptionState {
  const item = sub.items.data.find((i) => planOfPrice(i.price));
  const parsed = planOfPrice(item?.price);
  const givesPlan = ['active', 'trialing', 'past_due'].includes(sub.status);
  return {
    plan: parsed?.plan ?? null,
    interval: parsed?.interval ?? null,
    status: sub.status,
    currentPeriodEnd: iso(item?.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    cancelAt: iso(sub.cancel_at) ?? (sub.cancel_at_period_end ? iso(item?.current_period_end) : null),
    endedAt: givesPlan ? null : (iso(sub.ended_at) ?? iso(sub.canceled_at) ?? new Date().toISOString()),
    trialEnd: sub.status === 'trialing' ? iso(sub.trial_end) : null,
  };
}

/**
 * Checks the Stripe-Signature header: HMAC-SHA256 of "<t>.<raw body>" with the endpoint secret, matched against any
 * v1 entry, and the timestamp within `toleranceSeconds` so a captured delivery cannot be replayed later.
 */
export function verifyStripeSignature(secret: string, raw: string, header: string | null, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): boolean {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  if (!Number.isFinite(t) || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${raw}`).digest();
  return parts
    .filter(([k, v]) => k === 'v1' && v && /^[0-9a-f]{64}$/.test(v))
    .some(([, v]) => timingSafeEqual(expected, Buffer.from(v as string, 'hex')));
}

/** The header Stripe would send; for tests and the fake. */
export function signStripePayload(secret: string, raw: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  return `t=${nowSeconds},v1=${createHmac('sha256', secret).update(`${nowSeconds}.${raw}`).digest('hex')}`;
}
