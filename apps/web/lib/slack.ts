import type { RunEmailInput } from './notify.ts';

/**
 * Only Slack's own webhook host is accepted: the server posts to this URL, so any other host would let a workspace
 * owner make it call internal addresses. SLACK_WEBHOOK_HOSTS adds hosts for local development and tests.
 */
export function validateSlackWebhook(value: string, extraHosts = process.env.SLACK_WEBHOOK_HOSTS ?? ''): { ok: true; url: string; hint: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, error: 'Paste the full webhook URL from Slack (https://hooks.slack.com/services/...).' };
  }
  const extra = extraHosts.split(',').map((h) => h.trim()).filter(Boolean);
  const slack = url.protocol === 'https:' && url.hostname === 'hooks.slack.com' && /^\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(url.pathname) && !url.search;
  if (!slack && !extra.includes(url.host)) return { ok: false, error: 'Only Slack incoming webhooks (https://hooks.slack.com/services/...) are accepted.' };
  const parts = url.pathname.split('/');
  const secret = parts.pop() ?? '';
  // Enough to recognise the webhook in the list, not enough to post with it.
  const hint = `${url.host}${parts.join('/')}/${secret.slice(0, 4)}…`;
  return { ok: true, url: url.toString(), hint };
}

/** A Slack message with the same content as the email: status, counts, link. Slack escapes only &, < and >. */
export function slackMessage(input: Omit<RunEmailInput, 'to' | 'settingsUrl'>): { text: string } {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const s = input.summary;
  const cases = (['DIFF', 'ERROR', 'BLOCKED', 'SKIPPED', 'PASS'] as const).filter((k) => s[k] > 0).map((k) => `${s[k]} ${k}`);
  const calls = [s.changed && `${s.changed} changed`, s.added && `${s.added} added`, s.removed && `${s.removed} removed`, s.blocked && `${s.blocked} blocked`].filter(Boolean);
  const kind = input.mode === 'upgrade' ? 'Engine upgrade check' : 'Run';
  return {
    text: `*${esc(input.status)}* · ${kind} of "${esc(input.workflowName)}" in ${esc(input.workspaceName)}\n${s.cases} case${s.cases === 1 ? '' : 's'} (${cases.join(', ') || 'none'}) · calls: ${calls.join(', ') || 'no changes'}\n<${input.url}|Open the plan>`,
  };
}

export async function sendSlack(url: string, message: { text: string }): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message), signal: AbortSignal.timeout(10_000), redirect: 'error' });
    const text = await res.text();
    return { ok: res.ok, detail: `${res.status} ${text.slice(0, 100)}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
