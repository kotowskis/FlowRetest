import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server.ts';
import { contactEmail } from '@/lib/legal/provider.ts';
import { trialDays } from '@/lib/stripe.ts';
import { PublicShell, REPOSITORY_URL } from '@/components/public-shell.tsx';
import { buttonClass } from '@/components/ui.tsx';

export const metadata: Metadata = {
  title: { absolute: 'FlowRetest: see what an n8n workflow change would send' },
  description: 'FlowRetest replays recorded n8n executions through the old and the new version of a workflow in a sealed sandbox and lists every API call that would change. Open source runner, hosted history for agencies.',
  robots: { index: true },
};

const PLAN = `$ npx flowretest run --workflow 8Kq2 --new draft.json --stabilize

Plan: 3 calls (old version: 3). 1 changed, 0 added, 0 removed, 0 blocked.

~ [7] Push to ERP   POST erp.example.com/api/orders
      customer_id: "C-1" -> null
      ! empty value in an id field

Coverage: 3 of 3 write nodes captured (100%) · sandbox sealed, 0 requests left it
Result: DIFF (exit code 1)`;

const STEPS: Array<[string, string, string]> = [
  ['1', 'pull', 'The runner reads the published workflow and its last recorded executions through the n8n API. Each execution becomes a test case on your disk.'],
  ['2', 'run', 'Both versions run in your own n8n image inside a Docker network with no way out. Reads are replayed from the recording; writes go to a proxy that answers like the real API and records the request.'],
  ['3', 'plan', 'You get every outbound call of the new version next to the old one: + new, ~ changed, - gone, ! blocked. Exit code 1 on a difference, so CI can stop the merge.'],
];

const HOSTED: string[] = [
  'A workspace per customer n8n instance, with a token for its CI',
  'Run history and a comparison of any two runs of a workflow',
  'Approvals: who accepted which change, when, and why; the runner turns them into baselines',
  'A GitHub check on the tested commit, email and Slack messages on DIFF or ERROR',
  'A PDF record of what a change would send, for change reviews and ISO 27001 audits (Agency)',
  'An engine drift matrix: every workflow against every n8n version you tested (Agency)',
];

export default async function Home({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const db = await createClient();
  const { data } = await db.auth.getUser();
  if (data.user) redirect('/orgs');
  const { account } = await searchParams;
  const contact = contactEmail();
  const trial = trialDays();
  return (
    <PublicShell>
      <main>
        {account === 'deleted' ? <p role="status" className="bg-pass/10 px-4 py-2 text-center text-sm">Your account was deleted.</p> : null}
        <section className="mx-auto max-w-6xl px-4 pt-14 pb-10">
          <h1 className="max-w-3xl text-3xl leading-tight font-semibold sm:text-4xl">See what an n8n workflow change would send before it reaches your customers&apos; APIs.</h1>
          <p className="mt-5 max-w-2xl text-lg text-muted">
            FlowRetest replays real executions through the published version and your draft, in a sealed sandbox on your machine or in CI, and lists every HTTP call that would change.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={REPOSITORY_URL} className={buttonClass}>Get the runner (MIT)</a>
            <Link href="/pricing" className="rounded-md border border-line px-3 py-2 text-sm hover:bg-panel">Hosted plans</Link>
          </div>
          <pre className="mt-10 overflow-x-auto rounded-md border border-line bg-panel p-4 font-mono text-xs leading-relaxed">{PLAN}</pre>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-10">
          <h2 className="text-xl font-semibold">How a run works</h2>
          <ol className="mt-6 grid gap-6 md:grid-cols-3">
            {STEPS.map(([n, cmd, text]) => (
              <li key={n} className="rounded-md border border-line bg-panel p-5">
                <p className="font-mono text-sm">
                  <span className="text-muted">{n}.</span> flowretest {cmd}
                </p>
                <p className="mt-3 text-sm text-muted">{text}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 max-w-3xl text-sm text-muted">
            The runner contains no n8n code. It uses the official image of your version and reads your instance only through the public API. HTTP Request, Slack, HubSpot, Google Sheets, Airtable, Notion and OpenAI nodes are covered; database, mail and file writes never reach the network and are reported as skipped.
          </p>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-10">
          <h2 className="text-xl font-semibold">Before the n8n 3.0 upgrade</h2>
          <p className="mt-3 max-w-3xl text-sm text-muted">
            <code className="font-mono text-ink">flowretest upgrade-check --engine-old 2.40.5 --engine-new 3.0.0</code> runs the same workflow on two n8n images and opens the plan with the engine differences: nodes that ran on one version only, item counts, output keys, new errors. Run it for every customer instance before you move it.
          </p>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-10">
          <h2 className="text-xl font-semibold">For agencies with many customer instances</h2>
          <p className="mt-3 max-w-3xl text-sm text-muted">
            The runner is free and needs no account. The hosted layer keeps the redacted reports of your team and your customers in one place. Team is 79 EUR a month, Agency 199 EUR, excluding VAT{trial ? `, both with ${trial} days free to start` : ''}.
          </p>
          <ul className="mt-5 grid gap-2 text-sm md:grid-cols-2">
            {HOSTED.map((h) => (
              <li key={h} className="rounded-md border border-line bg-panel px-4 py-3">{h}</li>
            ))}
          </ul>
          <div className="mt-6 rounded-md border border-accent/40 bg-panel p-5 text-sm">
            <p className="font-medium">Onboarding for agencies</p>
            <p className="mt-2 text-muted">
              We set FlowRetest up on your customer instances with you: fixtures for the workflows that matter, CI on your repository, the first upgrade check. 1,000 to 2,500 EUR depending on the number of instances, with six months of the Team plan included.
            </p>
            {contact ? (
              <a href={`mailto:${contact}?subject=FlowRetest%20onboarding`} className="mt-3 inline-block underline">
                {contact}
              </a>
            ) : null}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-10">
          <h2 className="text-xl font-semibold">What leaves your machine</h2>
          <p className="mt-3 max-w-3xl text-sm text-muted">
            Nothing, unless you run <code className="font-mono text-ink">flowretest upload</code>. Then only a redacted report: names, hosts, URL templates, field names, and each text value as its type, length and a hash keyed with a secret that stays with you. Small numbers and true/false stay readable; <code className="font-mono text-ink">normalize.ignore</code> leaves a field out. Request bodies, fixtures and credentials stay in <code className="font-mono text-ink">.flowretest/</code>. See <Link href="/legal/retention" className="underline">data retention</Link> and the <Link href="/legal/dpa" className="underline">DPA</Link>.
          </p>
        </section>
      </main>
    </PublicShell>
  );
}
