/**
 * Credential stubs for the sandbox. Field names come from the credential
 * classes in n8n-nodes-base 2.40.5 (docs/spike/wyniki.md, day 3). Values are
 * fake by design: the proxy answers every call, so nothing ever validates them.
 */

export interface CredentialUseRef {
  type: string;
  id?: string;
  name?: string;
  node: string;
}

export interface CredentialStub {
  id: string;
  name: string;
  type: string;
  data: Record<string, unknown>;
}

export interface StubContext {
  /** PEM private key for service-account style credentials; generated once per run by the CLI. */
  privateKeyPem: () => string;
}

const MOCK_TOKEN = 'frt-mock';
/** About ten years; n8n refreshes only when the token is expired, and the proxy answers token URLs anyway. */
const FAR_EXPIRY_SECONDS = 315_360_000;

function oauthTokenData(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: MOCK_TOKEN,
    refresh_token: MOCK_TOKEN,
    token_type: 'Bearer',
    expires_in: FAR_EXPIRY_SECONDS,
    scope: '',
    ...extra,
  };
}

const KNOWN: Record<string, (ctx: StubContext) => Record<string, unknown>> = {
  httpHeaderAuth: () => ({ name: 'Authorization', value: `Bearer ${MOCK_TOKEN}` }),
  httpBasicAuth: () => ({ user: 'frt', password: 'frt' }),
  httpQueryAuth: () => ({ name: 'api_key', value: MOCK_TOKEN }),
  httpBearerAuth: () => ({ token: MOCK_TOKEN }),
  hubspotAppToken: () => ({ appToken: MOCK_TOKEN }),
  slackApi: () => ({ accessToken: `xoxb-${MOCK_TOKEN}`, signatureSecret: MOCK_TOKEN }),
  airtableTokenApi: () => ({ accessToken: MOCK_TOKEN }),
  notionApi: () => ({ apiKey: MOCK_TOKEN }),
  googleApi: (ctx) => ({ region: 'global', email: 'frt@frt-sandbox.iam.gserviceaccount.com', privateKey: ctx.privateKeyPem(), inpersonate: false, httpNode: false }),
  oAuth2Api: () => ({
    grantType: 'authorizationCode',
    authUrl: 'https://oauth.invalid/authorize',
    accessTokenUrl: 'https://oauth.invalid/token',
    clientId: 'frt',
    clientSecret: 'frt',
    scope: '',
    authentication: 'header',
    oauthTokenData: oauthTokenData(),
  }),
  hubspotDeveloperApi: () => ({ clientId: 'frt', clientSecret: 'frt', apiKey: MOCK_TOKEN, appId: 'frt', oauthTokenData: oauthTokenData() }),
  openAiApi: () => ({ apiKey: `sk-${MOCK_TOKEN}`, url: 'https://api.openai.com/v1' }),
  googlePalmApi: () => ({ host: 'https://generativelanguage.googleapis.com', apiKey: MOCK_TOKEN }),
  /** Non-HTTP drivers get a host that cannot resolve inside the sealed network, so the node fails loudly instead of leaking. */
  postgres: () => ({ host: 'db.frt.invalid', database: 'frt', user: 'frt', password: 'frt', port: 5432, ssl: 'disable', allowUnauthorizedCerts: false, maxConnections: 2 }),
  mySql: () => ({ host: 'db.frt.invalid', database: 'frt', user: 'frt', password: 'frt', port: 3306 }),
};

/** Types that extend oAuth2Api and only need client id, secret and token data. */
function isOAuth2Type(type: string): boolean {
  return /OAuth2Api$/.test(type);
}

export function credentialStubData(type: string, ctx: StubContext): { data: Record<string, unknown>; known: boolean } {
  const builder = KNOWN[type];
  if (builder) return { data: builder(ctx), known: true };
  if (isOAuth2Type(type)) return { data: { clientId: 'frt', clientSecret: 'frt', oauthTokenData: oauthTokenData() }, known: true };
  return { data: {}, known: false };
}

/** One stub per distinct credential id (or type+name when the workflow has no id), keeping the ids the nodes reference. */
export function buildCredentialStubs(uses: CredentialUseRef[], ctx: StubContext): { stubs: CredentialStub[]; unknownTypes: string[] } {
  const stubs = new Map<string, CredentialStub>();
  const unknown = new Set<string>();
  for (const use of uses) {
    const id = use.id ?? `frt${simpleHash(`${use.type}:${use.name ?? use.node}`)}`;
    if (stubs.has(id)) continue;
    const { data, known } = credentialStubData(use.type, ctx);
    if (!known) unknown.add(use.type);
    stubs.set(id, { id, name: use.name ?? `frt ${use.type}`, type: use.type, data });
  }
  return { stubs: [...stubs.values()], unknownTypes: [...unknown] };
}

function simpleHash(text: string): string {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36).padStart(7, '0').slice(0, 13);
}
