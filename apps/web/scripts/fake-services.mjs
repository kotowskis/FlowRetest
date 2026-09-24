// Stand-ins for GitHub (API, OAuth, app install page) and Slack incoming webhooks, for local development and the
// integration tests. Never used in production: the app talks to them only when .env.local points GITHUB_APP_API_URL,
// GITHUB_APP_WEB_URL and SLACK_WEBHOOK_HOSTS here.
//
//   node scripts/fake-services.mjs init    # key pair in .fake-services/, GitHub App settings appended to .env.local
//   node scripts/fake-services.mjs serve   # listen on 127.0.0.1:55390 (FAKE_SERVICES_PORT)
//
// Installations: 1001 belongs to the organization "acme-agency", whose member is the user "agency-dev"; 1002 belongs
// to "someone-else". OAuth codes are "code-<login>" and give the token "gho_<login>". GET /__calls lists every request
// the fake received, DELETE /__calls clears the list.
import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const keyDir = `${root}.fake-services`;
export const FAKE = { appId: '4242', slug: 'flowretest-dev', clientId: 'Iv1.fakeclient', clientSecret: 'fake-client-secret', webhookSecret: 'fake-webhook-secret' };
const INSTALLATIONS = [
  { id: 1001, account: { login: 'acme-agency', type: 'Organization' }, users: ['agency-dev'] },
  { id: 1002, account: { login: 'someone-else', type: 'User' }, users: ['someone-else'] },
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
      let m;
      if (req.method === 'POST' && (m = /^\/api\/app\/installations\/(\d+)\/access_tokens$/.exec(url.pathname))) {
        if (!verifyJwt(auth, publicKeyPem)) return json(res, 401, { message: 'A JSON web token could not be decoded' });
        if (!INSTALLATIONS.some((i) => i.id === Number(m[1]))) return json(res, 404, { message: 'Not Found' });
        return json(res, 201, { token: `ghs_fake_${m[1]}`, expires_at: new Date(Date.now() + 3600_000).toISOString() });
      }
      if (req.method === 'POST' && (m = /^\/api\/repos\/([^/]+)\/([^/]+)\/check-runs$/.exec(url.pathname))) {
        const installation = INSTALLATIONS.find((i) => auth === `ghs_fake_${i.id}`);
        if (!installation) return json(res, 401, { message: 'Bad credentials' });
        if (installation.account.login.toLowerCase() !== m[1].toLowerCase()) return json(res, 403, { message: 'Resource not accessible by integration' });
        if (!/^[0-9a-f]{40}$/.test(body?.head_sha ?? '')) return json(res, 422, { message: 'Invalid head_sha' });
        const id = nextCheck++;
        return json(res, 201, { id, html_url: `http://fake/${m[1]}/${m[2]}/runs/${id}`, conclusion: body.conclusion });
      }
      if (req.method === 'GET' && url.pathname === '/api/user/installations') {
        const login = auth.startsWith('gho_') ? auth.slice(4) : undefined;
        if (!login) return json(res, 401, { message: 'Bad credentials' });
        return json(res, 200, { total_count: 1, installations: INSTALLATIONS.filter((i) => i.users.includes(login)).map(({ id, account }) => ({ id, account })) });
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
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, calls, close: () => new Promise((resolve) => server.close(() => resolve())) };
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
    const existing = existsSync(envFile) ? readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => l && !/^(GITHUB_|SLACK_WEBHOOK_HOSTS=)/.test(l)) : [];
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
    ];
    writeFileSync(envFile, [...existing, ...lines, ''].join('\n'));
    console.log(`fake GitHub App settings written to ${envFile}; start the fake with: node scripts/fake-services.mjs serve`);
  } else {
    const appUrl = (process.env.APP_URL ?? 'http://127.0.0.1:3100').replace(/\/+$/, '');
    const fake = await startFakeServices({ port, publicKeyPem: keys.publicKey, appUrl });
    console.log(`fake GitHub and Slack on ${fake.base}`);
  }
}
