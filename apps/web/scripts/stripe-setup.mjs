// Creates the products and prices of the paid plans in a Stripe account, once per account (test mode first).
// Prices are found by lookup key (flowretest_<plan>_<monthly|yearly>), so the app needs no price ids in its settings.
// The amounts match the `plans` table (migration 20261214000000_billing.sql); change both together.
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs --webhook https://<domain>/api/stripe/webhook
//
// With --webhook it also creates the webhook endpoint and prints its signing secret for STRIPE_WEBHOOK_SECRET.
// STRIPE_API_URL points it elsewhere (scripts/fake-services.mjs serves /stripe).
import { existsSync, readFileSync } from 'node:fs';

const envFile = new URL('../.env.local', import.meta.url);
if (!process.env.STRIPE_SECRET_KEY && existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^(STRIPE_[A-Z_]+)=(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('set STRIPE_SECRET_KEY (a test key first: sk_test_...)');
  process.exit(2);
}
const api = (process.env.STRIPE_API_URL || 'https://api.stripe.com').replace(/\/+$/, '');
const VERSION = '2026-02-25.clover';

export const PLANS = [
  { plan: 'team', name: 'FlowRetest Team', month: 7900, year: 75840 },
  { plan: 'agency', name: 'FlowRetest Agency', month: 19900, year: 191040 },
];
export const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.pending_update_applied',
  'customer.subscription.pending_update_expired',
  'invoice.finalized',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.voided',
  'invoice.marked_uncollectible',
  'invoice.updated',
];

async function stripe(method, path, params = {}) {
  const body = new URLSearchParams();
  const walk = (value, k) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${k}[${i}]`));
    else if (typeof value === 'object') for (const [kk, v] of Object.entries(value)) walk(v, k ? `${k}[${kk}]` : kk);
    else body.append(k, String(value));
  };
  walk(params, '');
  const url = method === 'GET' ? `${api}${path}?${body}` : `${api}${path}`;
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${key}`, 'stripe-version': VERSION, ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: method === 'POST' ? body.toString() : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${json.error?.message ?? ''}`);
  return json;
}

console.log(`Stripe account behind ${key.slice(0, 8)}… (${key.startsWith('sk_live_') ? 'LIVE mode' : 'test mode'})`);
for (const p of PLANS) {
  let product;
  for (const [period, interval, amount] of [['monthly', 'month', p.month], ['yearly', 'year', p.year]]) {
    const lookup = `flowretest_${p.plan}_${period}`;
    const found = await stripe('GET', '/v1/prices', { lookup_keys: [lookup], active: true, limit: 1 });
    if (found.data.length > 0) {
      const price = found.data[0];
      const same = price.unit_amount === amount && price.currency === 'eur' && price.recurring?.interval === interval;
      console.log(`${lookup}: exists (${price.id})${same ? '' : `, but it is ${price.unit_amount} ${price.currency}/${price.recurring?.interval}; create a new price with transfer_lookup_key to change it`}`);
      // The app reads the plan from the price's metadata; prices made before that get it now.
      if (price.metadata?.flowretest_plan !== p.plan) await stripe('POST', `/v1/prices/${price.id}`, { metadata: { flowretest_plan: p.plan } });
      // The other price of the plan goes to the same product instead of a second one.
      product ??= { id: typeof price.product === 'string' ? price.product : price.product.id };
      continue;
    }
    product ??= await stripe('POST', '/v1/products', { name: p.name, metadata: { flowretest_plan: p.plan } });
    const price = await stripe('POST', '/v1/prices', {
      product: product.id,
      currency: 'eur',
      unit_amount: amount,
      recurring: { interval },
      lookup_key: lookup,
      // The plan the app gives for this price. A new price that takes over the lookup key (transfer_lookup_key) must
      // carry it too; subscribers who stay on the old price keep their plan through this field.
      metadata: { flowretest_plan: p.plan },
      // The prices on the pricing page are without VAT.
      tax_behavior: 'exclusive',
      nickname: `${p.name} ${period}`,
    });
    console.log(`${lookup}: created ${price.id} (${amount / 100} EUR / ${interval})`);
  }
}

const hook = process.argv.indexOf('--webhook');
if (hook > 0) {
  const url = process.argv[hook + 1];
  if (!url?.startsWith('https://')) {
    console.error('--webhook needs the https URL of /api/stripe/webhook');
    process.exit(2);
  }
  const endpoint = await stripe('POST', '/v1/webhook_endpoints', { url, enabled_events: WEBHOOK_EVENTS, api_version: VERSION, description: 'FlowRetest billing' });
  console.log(`webhook endpoint ${endpoint.id} for ${url}`);
  console.log(`STRIPE_WEBHOOK_SECRET=${endpoint.secret}`);
} else {
  console.log(`\nWebhook: add https://<domain>/api/stripe/webhook with these events (or rerun with --webhook <url>):\n  ${WEBHOOK_EVENTS.join('\n  ')}`);
}
