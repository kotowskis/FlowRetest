/**
 * Sub-processor change notices (DPA section 6, ADR 0016). The founder announces a change with
 * scripts/subprocessor-notice.ts at least 30 days ahead; the database refuses a shorter notice. The notice shows on
 * /legal/subprocessors and goes by email to the owners of every organization that accepted the DPA, one email per
 * person. Sending is safe to repeat: addresses that already got the email are skipped, failed ones are tried again.
 */
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import type { MailMessage, MailResult } from './mail.ts';

export const NOTICE_DAYS = 30;

export const SubprocessorChangeSchema = z.object({
  action: z.enum(['add', 'remove', 'change']),
  name: z.string().trim().min(1).max(200),
  purpose: z.string().trim().max(300).default(''),
  data: z.string().trim().max(300).default(''),
  location: z.string().trim().max(300).default(''),
});

export const NoticeInputSchema = z.object({
  effectiveOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'effectiveOn is a date like 2026-12-01'),
  summary: z.string().trim().min(1).max(2000),
  changes: z.array(SubprocessorChangeSchema).min(1).max(20),
});

export type SubprocessorChange = z.infer<typeof SubprocessorChangeSchema>;
export type NoticeInput = z.infer<typeof NoticeInputSchema>;

export interface Notice {
  id: string;
  announced_at: string;
  effective_on: string;
  summary: string;
  changes: SubprocessorChange[];
}

/** The first day a change may take effect when announced at `now`. */
export function earliestEffectiveOn(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + NOTICE_DAYS));
  return d.toISOString().slice(0, 10);
}

const ACTION: Record<SubprocessorChange['action'], string> = { add: 'New', remove: 'Removed', change: 'Changed' };

export function changeLine(c: SubprocessorChange): string {
  const details = [c.purpose, c.data && `data: ${c.data}`, c.location && `location: ${c.location}`].filter(Boolean).join('; ');
  return `${ACTION[c.action]}: ${c.name}${details ? ` (${details})` : ''}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
}

export interface NoticeEmailInput {
  to: string;
  organizationNames: string[];
  notice: Notice;
  appUrl: string;
  /** Where objections go (LEGAL_EMAIL); without it the email points to the page only. */
  contact?: string;
}

export function noticeEmail(input: NoticeEmailInput): MailMessage {
  const { notice } = input;
  const page = `${input.appUrl}/legal/subprocessors`;
  const orgs = input.organizationNames.map((n) => `"${n}"`).join(', ');
  const object = input.contact
    ? `If you object to the change, reply to this email or write to ${input.contact} before ${notice.effective_on}. If we find no solution, you may end the affected paid plan and get back what you paid for the unused period (section 6 of the DPA).`
    : `If you object to the change, write to us before ${notice.effective_on}. If we find no solution, you may end the affected paid plan and get back what you paid for the unused period (section 6 of the DPA).`;
  const text = [
    `FlowRetest will change its sub-processors on ${notice.effective_on}.`,
    '',
    notice.summary,
    '',
    ...notice.changes.map((c) => `- ${changeLine(c)}`),
    '',
    object,
    '',
    `The current list and all announced changes: ${page}`,
    '',
    `You get this email as an owner of ${orgs}, which accepted the FlowRetest Data Processing Agreement.`,
  ].join('\n');
  const html = [
    `<p>FlowRetest will change its sub-processors on <strong>${escapeHtml(notice.effective_on)}</strong>.</p>`,
    `<p>${escapeHtml(notice.summary)}</p>`,
    `<ul>${notice.changes.map((c) => `<li>${escapeHtml(changeLine(c))}</li>`).join('')}</ul>`,
    `<p>${escapeHtml(object)}</p>`,
    `<p><a href="${escapeHtml(page)}">The current list and all announced changes</a></p>`,
    `<p style="color:#6f6a62;font-size:12px">You get this email as an owner of ${escapeHtml(orgs)}, which accepted the FlowRetest Data Processing Agreement.</p>`,
  ].join('\n');
  return {
    to: input.to,
    subject: `[FlowRetest] Sub-processor change on ${notice.effective_on}`,
    text,
    html,
    ...(input.contact ? { headers: { 'Reply-To': input.contact } } : {}),
  };
}

type Db = SupabaseClient<Database>;

export async function announceNotice(db: Db, input: NoticeInput): Promise<Notice> {
  const { data, error } = await db.from('subprocessor_notices').insert({ effective_on: input.effectiveOn, summary: input.summary, changes: input.changes }).select('*').single();
  if (error?.code === '23514') throw new Error(`a change must be announced at least ${NOTICE_DAYS} days ahead: the earliest date today is ${earliestEffectiveOn(new Date())}`);
  if (error || !data) throw new Error(`could not store the notice: ${error?.message}`);
  return data as unknown as Notice;
}

export interface SendReport {
  sent: number;
  failed: number;
  skipped: number;
  recipients: number;
}

/** Emails the notice to every recipient who has not got it yet; `dryRun` only counts. */
export async function sendNotice(
  db: Db,
  noticeId: string,
  options: { send: (message: MailMessage) => Promise<MailResult>; appUrl: string; contact?: string; dryRun?: boolean },
): Promise<SendReport> {
  const { data: notice, error } = await db.from('subprocessor_notices').select('*').eq('id', noticeId).maybeSingle();
  if (error || !notice) throw new Error(`notice ${noticeId} not found${error ? `: ${error.message}` : ''}`);
  const [{ data: recipients, error: rError }, { data: done, error: dError }] = await Promise.all([
    db.rpc('subprocessor_notice_recipients'),
    db.from('subprocessor_notice_deliveries').select('email').eq('notice_id', noticeId).eq('ok', true),
  ]);
  if (rError || dError) throw new Error(`recipients: ${(rError ?? dError)?.message}`);
  const already = new Set((done ?? []).map((d) => d.email));
  const report: SendReport = { sent: 0, failed: 0, skipped: 0, recipients: recipients?.length ?? 0 };
  for (const r of recipients ?? []) {
    if (already.has(r.email)) {
      report.skipped += 1;
      continue;
    }
    if (options.dryRun) continue;
    const result = await options.send(noticeEmail({ to: r.email, organizationNames: r.organization_names, notice: notice as unknown as Notice, appUrl: options.appUrl, contact: options.contact }));
    const row = { notice_id: noticeId, email: r.email, organization_ids: r.organization_ids, ok: result.ok, detail: `${result.transport}: ${result.detail ?? ''}`.slice(0, 500), sent_at: new Date().toISOString() };
    const { error: wError } = await db.from('subprocessor_notice_deliveries').upsert(row);
    if (wError) throw new Error(`delivery of ${r.email}: ${wError.message}`);
    if (result.ok) report.sent += 1;
    else report.failed += 1;
  }
  return report;
}
