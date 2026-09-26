import { testMode } from './test-mode.ts';

/**
 * Outgoing mail. The production provider is not chosen yet (ADR 0008), so the transport is picked from the
 * environment: Resend when RESEND_API_KEY is set, the local Mailpit when MAILPIT_URL is set, otherwise the message is
 * only logged. Every transport is one HTTP call; no SMTP client in the app.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>;
  /** Resend's Idempotency-Key: the same key within 24 hours sends nothing a second time. */
  idempotencyKey?: string;
}

export interface MailResult {
  ok: boolean;
  transport: 'resend' | 'mailpit' | 'log';
  detail?: string;
}

export interface MailEnv {
  RESEND_API_KEY?: string;
  /** Test mode (lib/test-mode.ts) never mails real people, whatever .env.local holds; it needs these three. */
  FLOWRETEST_TEST_MODE?: string;
  APP_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  MAILPIT_URL?: string;
  MAIL_FROM?: string;
}

const DEFAULT_FROM = 'FlowRetest <noreply@flowretest.local>';

function parseFrom(from: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1] || undefined, email: m[2] as string } : { email: from.trim() };
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    const text = await res.text();
    return { ok: res.ok, detail: res.ok ? text.slice(0, 200) : `${res.status}: ${text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendMail(input: MailMessage, env: MailEnv = process.env as MailEnv): Promise<MailResult> {
  // A workflow name with a line break must not start a new header line, whatever the provider does with it.
  const message = { ...input, subject: input.subject.replace(/[\r\n]+/g, ' ') };
  const from = env.MAIL_FROM || DEFAULT_FROM;
  if (env.RESEND_API_KEY && !testMode(env as Record<string, string | undefined>)) {
    const r = await post('https://api.resend.com/emails', { authorization: `Bearer ${env.RESEND_API_KEY}`, ...(message.idempotencyKey ? { 'idempotency-key': message.idempotencyKey } : {}) }, { from, to: [message.to], subject: message.subject, text: message.text, html: message.html, ...(message.headers ? { headers: message.headers } : {}) });
    return { ok: r.ok, transport: 'resend', detail: r.detail };
  }
  if (env.MAILPIT_URL) {
    const sender = parseFrom(from);
    const r = await post(`${env.MAILPIT_URL.replace(/\/+$/, '')}/api/v1/send`, {}, { From: { Email: sender.email, Name: sender.name ?? '' }, To: [{ Email: message.to }], Subject: message.subject, Text: message.text, HTML: message.html, ...(message.headers ? { Headers: message.headers } : {}) });
    return { ok: r.ok, transport: 'mailpit', detail: r.detail };
  }
  console.info(`[mail] no transport configured; would send "${message.subject}" to ${message.to}`);
  return { ok: true, transport: 'log', detail: 'no transport configured' };
}
