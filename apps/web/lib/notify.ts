import type { RunSummary } from './ingest.ts';
import type { MailMessage } from './mail.ts';

export interface RunEmailInput {
  to: string;
  status: string;
  mode: string;
  workflowName: string;
  workspaceName: string;
  summary: RunSummary;
  url: string;
  settingsUrl: string;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * The notification about one uploaded run. Counts, names and a link only: the report is redacted anyway, and a
 * mailbox is a worse place for it than the app.
 */
export function runEmail(input: RunEmailInput): MailMessage {
  const s = input.summary;
  const kind = input.mode === 'upgrade' ? 'Engine upgrade check' : 'Run';
  const cases = (['DIFF', 'ERROR', 'BLOCKED', 'SKIPPED', 'PASS'] as const).filter((k) => s[k] > 0).map((k) => `${s[k]} ${k}`);
  const calls = [s.changed && `${s.changed} changed`, s.added && `${s.added} added`, s.removed && `${s.removed} removed`, s.blocked && `${s.blocked} blocked`].filter(Boolean) as string[];
  const lines = [
    `${kind} of "${input.workflowName}" in ${input.workspaceName}: ${input.status}`,
    '',
    `Cases: ${plural(s.cases, 'case')} (${cases.join(', ') || 'none'})`,
    `Calls: ${calls.join(', ') || 'no changes'}`,
    '',
    `Open the plan: ${input.url}`,
    '',
    `You get this email because you subscribed to ${input.status} runs of this workspace: ${input.settingsUrl}`,
  ];
  const html = [
    `<p><strong>${escapeHtml(kind)} of "${escapeHtml(input.workflowName)}"</strong> in ${escapeHtml(input.workspaceName)}: <strong>${escapeHtml(input.status)}</strong></p>`,
    `<p>Cases: ${escapeHtml(plural(s.cases, 'case'))} (${escapeHtml(cases.join(', ') || 'none')})<br>Calls: ${escapeHtml(calls.join(', ') || 'no changes')}</p>`,
    `<p><a href="${escapeHtml(input.url)}">Open the plan</a></p>`,
    `<p style="color:#6f6a62;font-size:12px">You get this email because you subscribed to ${escapeHtml(input.status)} runs of this workspace. <a href="${escapeHtml(input.settingsUrl)}">Change it</a>.</p>`,
  ].join('\n');
  // The settings page is where a member turns these emails off; mail clients show it as an unsubscribe link.
  return { to: input.to, subject: `[FlowRetest] ${input.status}: ${input.workflowName} (${input.workspaceName})`, text: lines.join('\n'), html, headers: { 'List-Unsubscribe': `<${input.settingsUrl}>` } };
}
