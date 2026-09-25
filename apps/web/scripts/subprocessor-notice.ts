/**
 * Announces a change of sub-processors and emails the owners who accepted the DPA (ADR 0016).
 *
 *   node scripts/subprocessor-notice.ts announce notice.json      # stores the notice, prints its id
 *   node scripts/subprocessor-notice.ts send <notice id> [--dry-run]
 *   node scripts/subprocessor-notice.ts list
 *
 * notice.json: {"effectiveOn": "2026-12-01", "summary": "...", "changes": [{"action": "add", "name": "...",
 * "purpose": "...", "data": "...", "location": "..."}]}. The effective date is at least 30 days away; the database
 * refuses a shorter notice. `send` is safe to repeat. It uses NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * APP_URL, LEGAL_EMAIL and the mail settings (RESEND_API_KEY or MAILPIT_URL, MAIL_FROM) from the environment or
 * apps/web/.env.local. After the effective date, update SUBPROCESSORS in lib/legal/documents.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types.ts';
import { sendMail } from '../lib/mail.ts';
import { NoticeInputSchema, announceNotice, changeLine, earliestEffectiveOn, sendNotice } from '../lib/subprocessor-notices.ts';

const envFile = new URL('../.env.local', import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m && !process.env[m[1] as string]) process.env[m[1] as string] = m[2];
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const appUrl = (process.env.APP_URL ?? 'http://127.0.0.1:3100').replace(/\/+$/, '');

const [command, arg] = process.argv.slice(2);

if (command === 'announce' && arg) {
  const input = NoticeInputSchema.parse(JSON.parse(readFileSync(arg, 'utf8')));
  const notice = await announceNotice(db, input);
  console.log(`announced ${notice.id}: effective on ${notice.effective_on}`);
  for (const c of notice.changes) console.log(`  ${changeLine(c)}`);
  console.log(`next: node scripts/subprocessor-notice.ts send ${notice.id}`);
} else if (command === 'send' && arg) {
  const dryRun = process.argv.includes('--dry-run');
  const report = await sendNotice(db, arg, { send: (m) => sendMail(m), appUrl, contact: process.env.LEGAL_EMAIL?.trim() || undefined, dryRun });
  console.log(`${dryRun ? 'dry run: ' : ''}${report.recipients} recipients, ${report.sent} sent, ${report.failed} failed, ${report.skipped} already had it`);
  if (report.failed > 0) process.exitCode = 1;
} else if (command === 'list') {
  const { data, error } = await db.from('subprocessor_notices').select('id, announced_at, effective_on, summary').order('announced_at', { ascending: false });
  if (error) throw error;
  for (const n of data ?? []) console.log(`${n.id}  announced ${n.announced_at.slice(0, 10)}  effective ${n.effective_on}  ${n.summary.slice(0, 60)}`);
  if (!data?.length) console.log(`no notices; a change announced today takes effect on ${earliestEffectiveOn(new Date())} at the earliest`);
} else {
  console.error('usage: node scripts/subprocessor-notice.ts announce <notice.json> | send <notice id> [--dry-run] | list');
  process.exitCode = 4;
}
