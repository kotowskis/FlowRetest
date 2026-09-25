// Stand-ins for GitHub (API, OAuth, app install page), Slack incoming webhooks and Stripe (billing), for local
// development and the integration tests. Never used in production: the app talks to them only when .env.local points
// GITHUB_APP_API_URL, GITHUB_APP_WEB_URL, SLACK_WEBHOOK_HOSTS and STRIPE_API_URL here.
//
//   node scripts/fake-services.mjs init    # key pair in .fake-services/, GitHub App and Stripe settings in .env.local
//   node scripts/fake-services.mjs serve   # listen on 127.0.0.1:55390 (FAKE_SERVICES_PORT)
//
// Installations: 1001 belongs to the organization "acme-agency": "agency-dev" administers its repository "flows",
// "contractor" reads it and administers nothing; 1002 belongs to "someone-else". OAuth codes are "code-<login>" and
// give the token "gho_<login>". GET /__calls lists every request the fake received, DELETE /__calls clears the list.
import { createHmac, createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const keyDir = `${root}.fake-services`;
export const FAKE = {
  appId: '4242',
  slug: 'flowretest-dev',
  clientId: 'Iv1.fakeclient',
  clientSecret: 'fake-client-secret',
  webhookSecret: 'fake-webhook-secret',
  stripeKey: 'sk_test_fake',
  stripeWebhookSecret: 'whsec_fake',
};
// The four prices scripts/stripe-setup.mjs creates in a real account, with the same lookup keys.
const PRICES = [
  ['team', 'monthly', 'month', 7900],
  ['team', 'yearly', 'year', 75840],
  ['agency', 'monthly', 'month', 19900],
  ['agency', 'yearly', 'year', 191040],
].map(([plan, period, interval, amount]) => ({ id: `price_${plan}_${period}`, object: 'price', active: true, lookup_key: `flowretest_${plan}_${period}`, unit_amount: amount, currency: 'eur', recurring: { interval }, metadata: { flowretest_plan: plan } }));

/**
 * Stripe: customers, prices by lookup key, Checkout (GET /stripe/pay/<session> plays the payment page: it creates the
 * subscription and a paid invoice, delivers signed webhooks to the app and redirects to success_url; ?outcome=cancel
 * goes to cancel_url, ?deliver=0 skips the webhooks), subscriptions, invoices, the customer portal. Control endpoints:
 * POST /__stripe/subscriptions/<id> {status, cancel_at_period_end, cancel_at} changes a subscription as Stripe would
 * after a failed card or a cancellation (classic mode sets cancel_at_period_end, flexible mode cancel_at) and delivers
 * the event, and {end_trial: true} ends a trial the way Stripe does on its last day (status active, the first real
 * invoice, paid or failed by fail_payments); POST /__stripe/customers/<id> {fail_payments} makes the customer's next charges fail (and {deleted}
 * deletes it), so a plan change
 * with payment_behavior=pending_if_incomplete stays pending; GET /__stripe dumps the state. As in Stripe, an
 * idempotency key reused with other parameters is refused.
 */
function fakeStripe({ appUrl, baseOf }) {
  const state = { customers: new Map(), sessions: new Map(), subscriptions: new Map(), invoices: new Map(), idempotency: new Map(), deliveries: [] };
  // Ids continue across restarts of the fake, so a local database that keeps customers from earlier runs never sees
  // the same cus_/sub_ id twice.
  let n = Date.now();
  const now = () => Math.floor(Date.now() / 1000);
  const err = (res, status, message, code) => json(res, status, { error: { message, type: 'invalid_request_error', ...(code ? { code } : {}) } });

  async function deliver(type, object) {
    const body = JSON.stringify({ id: `evt_${n++}`, object: 'event', type, created: now(), data: { object } });
    const t = now();
    const signature = `t=${t},v1=${createHmac('sha256', FAKE.stripeWebhookSecret).update(`${t}.${body}`).digest('hex')}`;
    let status = 0;
    try {
      status = (await fetch(`${appUrl}/api/stripe/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body, signal: AbortSignal.timeout(20000) })).status;
    } catch {
      status = -1;
    }
    state.deliveries.push({ type, id: object.id, status });
  }

  function invoice(sub, amount, status = 'paid') {
    const id = `in_${n++}`;
    const item = sub.items.data[0];
    const paid = status === 'paid';
    const inv = {
      id, object: 'invoice', customer: sub.customer, number: `FAKE-${String(state.invoices.size + 1).padStart(4, '0')}`, status, currency: 'eur',
      total: amount, amount_paid: paid ? amount : 0, amount_due: paid ? 0 : amount, hosted_invoice_url: `${baseOf()}/stripe/invoices/${id}`, invoice_pdf: `${baseOf()}/stripe/invoices/${id}.pdf`,
      period_start: now(), period_end: item.current_period_end, created: now(), parent: { type: 'subscription_details', subscription_details: { subscription: sub.id } },
    };
    state.invoices.set(id, inv);
    return inv;
  }

  function periodEnd(price) {
    return now() + (price.recurring.interval === 'year' ? 365 : 30) * 86400;
  }

  async function handle(req, url, raw, res) {
    const form = Object.fromEntries(new URLSearchParams(typeof raw === 'string' ? raw : ''));
    const path = url.pathname;
    let m;
    if (path === '/__stripe' && req.method === 'GET') {
      return json(res, 200, { customers: [...state.customers.values()], sessions: [...state.sessions.values()], subscriptions: [...state.subscriptions.values()], invoices: [...state.invoices.values()], deliveries: state.deliveries });
    }
    if (req.method === 'POST' && (m = /^\/__stripe\/subscriptions\/([\w]+)$/.exec(path))) {
      const sub = state.subscriptions.get(m[1]);
      if (!sub) return err(res, 404, 'No such subscription');
      const change = raw ? JSON.parse(raw) : {};
      if (change.end_trial) {
        if (sub.status !== 'trialing') return err(res, 400, 'Subscription is not trialing');
        const failed = state.customers.get(sub.customer)?.fail_payments === true;
        const price = sub.items.data[0].price;
        sub.status = failed ? 'past_due' : 'active';
        sub.trial_end = null;
        sub.items.data[0].current_period_end = periodEnd(price);
        const inv = invoice(sub, price.unit_amount, failed ? 'open' : 'paid');
        await deliver('customer.subscription.updated', sub);
        await deliver(failed ? 'invoice.payment_failed' : 'invoice.paid', inv);
        return json(res, 200, { subscription: sub, deliveries: state.deliveries });
      }
      if (change.status) sub.status = change.status;
      if (change.cancel_at_period_end !== undefined) sub.cancel_at_period_end = change.cancel_at_period_end;
      if (change.cancel_at !== undefined) sub.cancel_at = change.cancel_at;
      if (sub.status === 'canceled') sub.ended_at = sub.canceled_at = now();
      await deliver(sub.status === 'canceled' ? 'customer.subscription.deleted' : 'customer.subscription.updated', sub);
      return json(res, 200, { subscription: sub, deliveries: state.deliveries });
    }
    if (req.method === 'POST' && (m = /^\/__stripe\/customers\/([\w]+)$/.exec(path))) {
      const customer = state.customers.get(m[1]);
      if (!customer) return err(res, 404, 'No such customer');
      const change = raw ? JSON.parse(raw) : {};
      // {deleted: true} plays a customer deleted in the Stripe dashboard.
      if (change.deleted) {
        state.customers.delete(m[1]);
        return json(res, 200, { id: m[1], deleted: true });
      }
      customer.fail_payments = change.fail_payments === true;
      return json(res, 200, customer);
    }
    if ((m = /^\/stripe\/pay\/([\w]+)$/.exec(path)) && req.method === 'GET') {
      const session = state.sessions.get(m[1]);
      if (!session) return err(res, 404, 'No such checkout session');
      if (url.searchParams.get('outcome') === 'cancel') {
        res.writeHead(302, { location: session.cancel_url }).end();
        return;
      }
      if (session.status !== 'complete') {
        const price = PRICES.find((p) => p.id === session.price);
        // With trial_period_days Stripe starts the subscription trialing: the period ends with the trial and the
        // first invoice is for 0.
        const trialEnd = session.trial_period_days ? now() + session.trial_period_days * 86400 : null;
        const sub = {
          id: `sub_${n++}`, object: 'subscription', customer: session.customer, status: trialEnd ? 'trialing' : 'active', cancel_at_period_end: false, ended_at: null, canceled_at: null, trial_end: trialEnd,
          metadata: session.subscription_metadata, items: { object: 'list', data: [{ id: `si_${n++}`, object: 'subscription_item', current_period_end: trialEnd ?? periodEnd(price), price }] },
        };
        state.subscriptions.set(sub.id, sub);
        Object.assign(session, { status: 'complete', subscription: sub.id });
        const inv = invoice(sub, trialEnd ? 0 : price.unit_amount);
        if (url.searchParams.get('deliver') !== '0') {
          await deliver('checkout.session.completed', { id: session.id, object: 'checkout.session', customer: session.customer, subscription: sub.id });
          await deliver('customer.subscription.created', sub);
          await deliver('invoice.paid', inv);
        }
      }
      res.writeHead(302, { location: session.success_url.replace('{CHECKOUT_SESSION_ID}', session.id) }).end();
      return;
    }
    if (path === '/stripe/portal' && req.method === 'GET') {
      res.writeHead(302, { location: url.searchParams.get('return_url') ?? appUrl }).end();
      return;
    }
    if (!path.startsWith('/stripe/v1/')) return err(res, 404, 'Unrecognized request URL');
    if ((req.headers.authorization ?? '') !== `Bearer ${FAKE.stripeKey}`) return err(res, 401, 'Invalid API Key provided');
    const api = path.slice('/stripe'.length);
    if (req.method === 'POST' && (m = /^\/v1\/customers\/([\w]+)$/.exec(api))) {
      const customer = state.customers.get(m[1]);
      if (!customer) return err(res, 404, `No such customer: '${m[1]}'`, 'resource_missing');
      if (form.email) customer.email = form.email;
      return json(res, 200, customer);
    }
    if (req.method === 'POST' && api === '/v1/customers') {
      const key = req.headers['idempotency-key'];
      const seen = key ? state.idempotency.get(key) : undefined;
      if (seen && seen.params !== raw) return err(res, 400, 'Keys for idempotent requests can only be used with the same parameters they were first used with.');
      if (seen) return json(res, 200, state.customers.get(seen.id));
      const customer = { id: `cus_${n++}`, object: 'customer', name: form.name, email: form.email, metadata: { organization_id: form['metadata[organization_id]'] } };
      state.customers.set(customer.id, customer);
      if (key) state.idempotency.set(key, { id: customer.id, params: raw });
      return json(res, 200, customer);
    }
    if (req.method === 'GET' && api === '/v1/prices') {
      const keys = [...url.searchParams.entries()].filter(([k]) => k.startsWith('lookup_keys')).map(([, v]) => v);
      const active = url.searchParams.get('active');
      return json(res, 200, { object: 'list', data: PRICES.filter((p) => keys.includes(p.lookup_key) && (active === null || String(p.active) === active)), has_more: false });
    }
    if (req.method === 'GET' && api === '/v1/subscriptions') {
      const customer = url.searchParams.get('customer');
      const status = url.searchParams.get('status') ?? 'active';
      const data = [...state.subscriptions.values()].filter((s) => s.customer === customer && (status === 'all' || s.status === status)).reverse();
      return json(res, 200, { object: 'list', data, has_more: false });
    }
    if (req.method === 'POST' && api === '/v1/checkout/sessions') {
      if (form.mode !== 'subscription') return err(res, 400, 'mode must be subscription');
      if (!state.customers.has(form.customer)) return err(res, 400, `No such customer: '${form.customer}'`, 'resource_missing');
      const key = req.headers['idempotency-key'];
      const seen = key ? state.idempotency.get(key) : undefined;
      if (seen && seen.params !== raw) return err(res, 400, 'Keys for idempotent requests can only be used with the same parameters they were first used with.');
      if (seen) return json(res, 200, state.sessions.get(seen.id));
      if (!PRICES.some((p) => p.id === form['line_items[0][price]'])) return err(res, 400, `No such price: '${form['line_items[0][price]']}'`);
      if (!form.success_url || !form.cancel_url) return err(res, 400, 'success_url and cancel_url are required');
      const id = `cs_test_${n++}`;
      const session = {
        id, object: 'checkout.session', url: `${baseOf()}/stripe/pay/${id}`, status: 'open', customer: form.customer, subscription: null, client_reference_id: form.client_reference_id ?? null,
        success_url: form.success_url, cancel_url: form.cancel_url, price: form['line_items[0][price]'], subscription_metadata: { organization_id: form['subscription_data[metadata][organization_id]'] },
        tax_id_collection: form['tax_id_collection[enabled]'] === 'true',
        trial_period_days: form['subscription_data[trial_period_days]'] ? Number(form['subscription_data[trial_period_days]']) : null,
        trial_missing_payment_method: form['subscription_data[trial_settings][end_behavior][missing_payment_method]'] ?? null,
        payment_method_collection: form.payment_method_collection ?? null,
      };
      state.sessions.set(id, session);
      if (key) state.idempotency.set(key, { id, params: raw });
      return json(res, 200, session);
    }
    if (req.method === 'GET' && (m = /^\/v1\/checkout\/sessions\/([\w]+)$/.exec(api))) {
      const session = state.sessions.get(m[1]);
      return session ? json(res, 200, session) : err(res, 404, 'No such checkout session');
    }
    if ((m = /^\/v1\/subscriptions\/([\w]+)$/.exec(api))) {
      const sub = state.subscriptions.get(m[1]);
      if (!sub) return err(res, 404, `No such subscription: '${m[1]}'`);
      if (req.method === 'DELETE') {
        // Cancel at once, as DELETE /v1/subscriptions/<id> does in Stripe.
        sub.status = 'canceled';
        sub.ended_at = sub.canceled_at = now();
        await deliver('customer.subscription.deleted', sub);
        return json(res, 200, sub);
      }
      if (req.method === 'POST') {
        const price = PRICES.find((p) => p.id === form['items[0][price]']);
        if (form['items[0][price]'] && !price) return err(res, 400, 'No such price');
        if (price && form['items[0][id]'] !== sub.items.data[0].id) return err(res, 400, 'items[0][id] does not belong to this subscription');
        // The prorated difference is billed at once (always_invoice); the fake charges the full new price for it.
        // Nothing is charged for a change during a trial, so nothing can fail.
        const failed = price && sub.status !== 'trialing' && state.customers.get(sub.customer)?.fail_payments === true;
        if (failed && form.payment_behavior === 'pending_if_incomplete') {
          // Stripe keeps the old price and records what waits for payment.
          sub.pending_update = { expires_at: now() + 23 * 3600, subscription_items: [{ id: sub.items.data[0].id, price: price.id }] };
          const inv = invoice(sub, price.unit_amount, 'open');
          await deliver('customer.subscription.updated', sub);
          await deliver('invoice.payment_failed', inv);
          return json(res, 200, sub);
        }
        const trialing = sub.status === 'trialing';
        if (price) sub.items.data[0] = { ...sub.items.data[0], price, current_period_end: trialing ? sub.trial_end : periodEnd(price) };
        sub.pending_update = null;
        if (form.cancel_at_period_end !== undefined) sub.cancel_at_period_end = form.cancel_at_period_end === 'true';
        await deliver('customer.subscription.updated', sub);
        if (price && trialing) await deliver('invoice.paid', invoice(sub, 0));
        else if (price) await deliver(failed ? 'invoice.payment_failed' : 'invoice.paid', invoice(sub, price.unit_amount, failed ? 'open' : 'paid'));
      }
      return json(res, 200, sub);
    }
    if (req.method === 'GET' && (m = /^\/v1\/invoices\/([\w]+)$/.exec(api))) {
      const inv = state.invoices.get(m[1]);
      return inv ? json(res, 200, inv) : err(res, 404, 'No such invoice');
    }
    if (req.method === 'POST' && api === '/v1/billing_portal/sessions') {
      if (!state.customers.has(form.customer)) return err(res, 400, 'No such customer');
      return json(res, 200, { id: `bps_${n++}`, object: 'billing_portal.session', url: `${baseOf()}/stripe/portal?return_url=${encodeURIComponent(form.return_url ?? '')}` });
    }
    return err(res, 404, 'Unrecognized request URL');
  }

  return { state, handle };
}
// repositories: name -> who administers it; the other users see the installation with read access only.
const INSTALLATIONS = [
  { id: 1001, account: { login: 'acme-agency', type: 'Organization' }, users: ['agency-dev', 'contractor'], repositories: { flows: ['agency-dev'], 'private-billing': [] } },
  { id: 1002, account: { login: 'someone-else', type: 'User' }, users: ['someone-else'], repositories: { flows: ['someone-else'] } },
];

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function verifyJwt(token, publicKeyPem) {
  const [head, body, sig] = (token ?? '').split('.');
  if (!head || !body || !sig) return undefined;
  const ok = createVerify('RSA-SHA256').update(`${head}.${body}`).verify(createPublicKey(publicKeyPem), Buffer.from(sig, 'base64url'));
  if (!ok) return undefined;
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  return claims.iss === FAKE.appId && claims.exp > now && claims.iat <= now ? claims : undefined;
}

/** Starts the fake on `port` (0 for any); resolves with its base URL, the recorded calls and a close function. */
export async function startFakeServices({ port = 0, publicKeyPem, appUrl }) {
  const calls = [];
  let nextCheck = 1;
  let base = '';
  const stripe = fakeStripe({ appUrl, baseOf: () => base });
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://fake');
      const auth = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      let body;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }
      if (url.pathname === '/__calls') {
        if (req.method === 'DELETE') calls.length = 0;
        return json(res, 200, calls);
      }
      calls.push({ method: req.method, path: url.pathname + url.search, body, auth: auth ? `${auth.slice(0, 12)}…` : undefined });
      if (url.pathname.startsWith('/stripe/') || url.pathname === '/__stripe' || url.pathname.startsWith('/__stripe/')) {
        stripe.handle(req, url, raw, res).catch((e) => json(res, 500, { error: { message: String(e) } }));
        return;
      }
      let m;
      if (req.method === 'POST' && (m = /^\/api\/app\/installations\/(\d+)\/access_tokens$/.exec(url.pathname))) {
        if (!verifyJwt(auth, publicKeyPem)) return json(res, 401, { message: 'A JSON web token could not be decoded' });
        const installation = INSTALLATIONS.find((i) => i.id === Number(m[1]));
        if (!installation) return json(res, 404, { message: 'Not Found' });
        // Like GitHub: a token limited to named repositories of the installation; unknown names are refused.
        const repos = body?.repositories ?? [];
        if (repos.length !== 1 || !(repos[0] in installation.repositories)) return json(res, 422, { message: 'There is at least one repository that does not exist or is not accessible to the parent installation.' });
        if (body?.permissions?.checks !== 'write') return json(res, 422, { message: 'permissions.checks must be write' });
        return json(res, 201, { token: `ghs_fake_${m[1]}_${repos[0]}`, expires_at: new Date(Date.now() + 3600_000).toISOString() });
      }
      if (req.method === 'POST' && (m = /^\/api\/repos\/([^/]+)\/([^/]+)\/check-runs$/.exec(url.pathname))) {
        const installation = INSTALLATIONS.find((i) => auth.startsWith(`ghs_fake_${i.id}_`));
        if (!installation) return json(res, 401, { message: 'Bad credentials' });
        if (installation.account.login.toLowerCase() !== m[1].toLowerCase() || auth !== `ghs_fake_${installation.id}_${m[2]}`) return json(res, 403, { message: 'Resource not accessible by integration' });
        if (!/^[0-9a-f]{40}$/.test(body?.head_sha ?? '')) return json(res, 422, { message: 'Invalid head_sha' });
        const id = nextCheck++;
        return json(res, 201, { id, html_url: `http://fake/${m[1]}/${m[2]}/runs/${id}`, conclusion: body.conclusion });
      }
      if (req.method === 'DELETE' && url.pathname === `/api/applications/${FAKE.clientId}/token`) {
        // Revoking a user token: GitHub answers 204 for the app's own client id and secret.
        const basic = Buffer.from(`${FAKE.clientId}:${FAKE.clientSecret}`).toString('base64');
        res.writeHead(req.headers.authorization === `Basic ${basic}` ? 204 : 401).end();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/user/installations') {
        const login = auth.startsWith('gho_') ? auth.slice(4) : undefined;
        if (!login) return json(res, 401, { message: 'Bad credentials' });
        return json(res, 200, { total_count: 1, installations: INSTALLATIONS.filter((i) => i.users.includes(login)).map(({ id, account }) => ({ id, account, suspended_at: null })) });
      }
      if (req.method === 'GET' && (m = /^\/api\/user\/installations\/(\d+)\/repositories$/.exec(url.pathname))) {
        const login = auth.startsWith('gho_') ? auth.slice(4) : undefined;
        const installation = INSTALLATIONS.find((i) => i.id === Number(m[1]));
        if (!login) return json(res, 401, { message: 'Bad credentials' });
        if (!installation || !installation.users.includes(login)) return json(res, 404, { message: 'Not Found' });
        const repositories = Object.entries(installation.repositories).map(([name, admins]) => ({ full_name: `${installation.account.login}/${name}`, permissions: { admin: admins.includes(login), push: admins.includes(login), pull: true } }));
        return json(res, 200, { total_count: repositories.length, repositories });
      }
      if (req.method === 'POST' && url.pathname === '/login/oauth/access_token') {
        if (body?.client_id !== FAKE.clientId || body?.client_secret !== FAKE.clientSecret) return json(res, 200, { error: 'incorrect_client_credentials' });
        if (!/^code-[\w-]+$/.test(body?.code ?? '')) return json(res, 200, { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' });
        return json(res, 200, { access_token: `gho_${body.code.slice(5)}`, token_type: 'bearer' });
      }
      if (req.method === 'GET' && url.pathname === `/apps/${FAKE.slug}/installations/new`) {
        // The install page: the person installs on acme-agency and GitHub sends them to the setup URL without a code.
        const target = new URL(`${appUrl}/api/github/setup`);
        target.searchParams.set('installation_id', url.searchParams.get('installation') ?? '1001');
        target.searchParams.set('setup_action', 'install');
        target.searchParams.set('state', url.searchParams.get('state') ?? '');
        res.writeHead(302, { location: target.toString() }).end();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/login/oauth/authorize') {
        const target = new URL(url.searchParams.get('redirect_uri') ?? `${appUrl}/api/github/setup`);
        target.searchParams.set('code', `code-${url.searchParams.get('as') ?? 'agency-dev'}`);
        target.searchParams.set('state', url.searchParams.get('state') ?? '');
        res.writeHead(302, { location: target.toString() }).end();
        return;
      }
      if (req.method === 'POST' && url.pathname.startsWith('/slack/services/')) {
        res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
        return;
      }
      json(res, 404, { message: 'Not Found' });
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return { base, calls, stripe: stripe.state, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

function ensureKeys() {
  mkdirSync(keyDir, { recursive: true });
  if (!existsSync(`${keyDir}/app.pem`)) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    writeFileSync(`${keyDir}/app.pem`, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    writeFileSync(`${keyDir}/app.pub.pem`, publicKey.export({ type: 'spki', format: 'pem' }));
  }
  return { privateKey: readFileSync(`${keyDir}/app.pem`, 'utf8'), publicKey: readFileSync(`${keyDir}/app.pub.pem`, 'utf8') };
}

const command = process.argv[2];
if (command === 'init' || command === 'serve') {
  const port = Number(process.env.FAKE_SERVICES_PORT ?? 55390);
  const keys = ensureKeys();
  if (command === 'init') {
    const envFile = `${root}.env.local`;
    const existing = existsSync(envFile) ? readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => l && !/^(GITHUB_|STRIPE_|SLACK_WEBHOOK_HOSTS=)/.test(l)) : [];
    const base = `http://127.0.0.1:${port}`;
    const lines = [
      `GITHUB_APP_ID=${FAKE.appId}`,
      `GITHUB_APP_SLUG=${FAKE.slug}`,
      `GITHUB_APP_CLIENT_ID=${FAKE.clientId}`,
      `GITHUB_APP_CLIENT_SECRET=${FAKE.clientSecret}`,
      `GITHUB_APP_WEBHOOK_SECRET=${FAKE.webhookSecret}`,
      `GITHUB_APP_PRIVATE_KEY=${keys.privateKey.trim().replace(/\n/g, '\\n')}`,
      `GITHUB_APP_API_URL=${base}/api`,
      `GITHUB_APP_WEB_URL=${base}`,
      `SLACK_WEBHOOK_HOSTS=127.0.0.1:${port}`,
      `STRIPE_SECRET_KEY=${FAKE.stripeKey}`,
      `STRIPE_WEBHOOK_SECRET=${FAKE.stripeWebhookSecret}`,
      `STRIPE_API_URL=${base}/stripe`,
    ];
    writeFileSync(envFile, [...existing, ...lines, ''].join('\n'));
    console.log(`fake GitHub App and Stripe settings written to ${envFile}; start the fake with: node scripts/fake-services.mjs serve`);
  } else {
    const appUrl = (process.env.APP_URL ?? 'http://127.0.0.1:3100').replace(/\/+$/, '');
    const fake = await startFakeServices({ port, publicKeyPem: keys.publicKey, appUrl });
    console.log(`fake GitHub and Slack on ${fake.base}`);
  }
}
