import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server.ts';
import { contactEmail } from '@/lib/legal/provider.ts';
import { trialDays } from '@/lib/stripe.ts';
import { PublicShell, REPOSITORY_URL } from '@/components/public-shell.tsx';
import { CopyCommand } from '@/components/copy-command.tsx';
import { OP_MARK, Printout, PrintoutRow } from '@/components/printout.tsx';
import { OpGlyph, StatusBadge, buttonClass, secondaryButtonClass } from '@/components/ui.tsx';

export const metadata: Metadata = {
  title: { absolute: 'FlowRetest: see what an n8n workflow change would send' },
  description: 'FlowRetest replays recorded n8n executions through the old and the new version of a workflow in a sealed sandbox and lists every API call that would change. Open source runner, hosted history for agencies.',
  robots: { index: true },
};

/** The sequence of one change, in the order the commands run. */
const STEPS: Array<[string, string]> = [
  ['pull', 'Reads the published workflow and its last recorded executions through the n8n API. Each execution becomes a test case on your disk.'],
  ['run', 'Runs both versions in your own n8n image inside a Docker network with no route out. Reads replay from the recording; writes reach a proxy that answers like the real API and keeps the request.'],
  ['accept', 'A difference exits with code 1, so CI can stop the merge. When it is the change you meant, accept makes the new calls the baseline.'],
];

const LEGEND: Array<[string, string]> = [
  ['+', 'new call'],
  ['~', 'changed call'],
  ['-', 'call no longer sent'],
  ['!', 'stopped by the seal'],
  ['=', 'unchanged'],
];

const STAYS = ['Recorded executions (fixtures)', 'Request bodies and every value in them', 'Credentials and the n8n API key', 'The full report of each run'];
const LEAVES: Array<[string, React.ReactNode]> = [
  ['Names', 'workflow, node and version file names'],
  ['Calls', 'methods, hosts, URL templates, field names'],
  ['Text values', <>as type, length and a keyed hash: <code className="font-mono text-ink">{'<string 12 #a1b2c3d4>'}</code></>],
  ['Numbers', 'below one million, and true/false, stay readable'],
];

const HOSTED: Array<[string, string, string?]> = [
  ['Workspaces', 'One per customer n8n instance, each with its own token for CI.'],
  ['History', 'Every uploaded run of a workflow, and a comparison of any two of them.'],
  ['Approvals', 'Who accepted which change, when and why. The runner turns them into baselines.'],
  ['Checks', 'A GitHub check on the tested commit; email and Slack on DIFF or ERROR.'],
  ['PDF record', 'What a change would send, for change reviews and ISO 27001 audits.', 'Agency'],
  ['Drift matrix', 'Every workflow against every n8n version you checked.', 'Agency'],
];

/** An example of the Agency drift matrix; the page says it is an example. */
const DRIFT: Array<[string, string, string, string]> = [
  ['Northwind CRM', '2.40.5', 'PASS', 'DIFF'],
  ['Globex Ops', '2.38.1', 'PASS', 'PASS'],
  ['Initech Billing', '2.40.5', 'ERROR', 'BLOCKED'],
];

function Mark({ op }: { op: string }) {
  return <OpGlyph op={op} className={OP_MARK[op]?.className ?? ''} />;
}

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

        <section aria-labelledby="hero" className="mx-auto max-w-6xl px-4 pt-14 pb-16 sm:px-6 sm:pt-20">
          <p className="eyebrow">Regression plans for n8n workflows</p>
          <h1 id="hero" className="mt-4 max-w-[14ch] font-dot text-[clamp(2.75rem,9vw,6.25rem)] leading-[0.92] font-black text-ink">
            What would this change send?
          </h1>
          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <p className="max-w-2xl text-lg leading-8 text-muted">
              FlowRetest replays real executions through the published workflow and your draft, in a sealed sandbox on your machine or in CI, and prints every HTTP call the draft would change{' '}
              <span className="text-ink">before it reaches your customers&apos; APIs.</span>
            </p>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col lg:items-stretch">
              <CopyCommand command="npx flowretest init" />
              <a href={REPOSITORY_URL} className={buttonClass}>Get the runner, MIT licence</a>
            </div>
          </div>

          <Printout className="mt-12" label="Example plan printed by flowretest run">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-dashed border-line px-3 py-3 font-mono text-xs text-muted sm:px-4">
              <span className="text-ink">
                <span aria-hidden className="mr-2 select-none">$</span>npx flowretest run --workflow 8Kq2 --new draft.json --stabilize
              </span>
              <span>FlowRetest 0.3.0 · n8nio/n8n:2.40.5</span>
            </div>
            <p className="px-3 py-3 font-mono text-sm font-bold sm:px-4 sm:pl-[3.75rem]">Plan: 4 calls (old version: 3). 1 changed, 1 added, 0 removed, 0 blocked.</p>
            <PrintoutRow mark="~">
              <p className="flex flex-wrap gap-x-3 font-mono text-sm leading-6">
                <span className="text-muted">[7]</span>
                <span className="font-sans font-bold">Push to ERP</span>
                <span className="break-all text-muted">POST erp.example.com/api/orders</span>
              </p>
              <p className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 font-mono text-sm leading-6">
                <span>customer_id</span>
                <span>
                  <del className="text-error decoration-1">&quot;C-1&quot;</del> <span aria-hidden className="text-muted">→</span> <ins className="text-pass no-underline">null</ins>
                </span>
              </p>
              <p className="mt-2 inline-block rounded-sm border border-diff/45 bg-diff/10 px-1.5 font-mono text-xs leading-5 text-diff">! empty value in an id field</p>
            </PrintoutRow>
            <PrintoutRow mark="+">
              <p className="flex flex-wrap gap-x-3 font-mono text-sm leading-6">
                <span className="text-muted">[7]</span>
                <span className="font-sans font-bold">Log order</span>
                <span className="break-all text-muted">POST sheets.googleapis.com/v4/spreadsheets/{'{id}'}/values/{'{range}'}:append</span>
              </p>
              <p className="mt-1 text-sm text-muted">new in this version</p>
            </PrintoutRow>
            <PrintoutRow mark="=">
              <p className="font-mono text-sm leading-6 text-muted">2 unchanged calls</p>
            </PrintoutRow>
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-t border-dashed border-line px-3 py-4 sm:px-4">
              <p className="max-w-xl font-mono text-xs leading-5 text-muted">
                Coverage: 3 of 3 write nodes captured (100%) · nodes replayed from recordings: 2 · <span className="text-pass">sandbox sealed (checked before the run), 0 requests left it</span>
              </p>
              <p className="flex items-baseline gap-3">
                <span className="font-mono text-xs text-muted">Result</span>
                <span className="font-dot text-5xl leading-none font-black text-diff">DIFF</span>
                <span className="font-mono text-xs text-muted">exit code 1</span>
              </p>
            </div>
          </Printout>

          <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
            {LEGEND.map(([op, text]) => (
              <div key={op} className="flex items-center gap-1.5">
                <dt><Mark op={op} /><span className="sr-only">{op}</span></dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="steps" className="border-y border-line bg-panel">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="steps" className="text-2xl font-bold tracking-tight sm:text-3xl">Three commands per change</h2>
            <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-0">
              {STEPS.map(([cmd, text], i) => (
                <li key={cmd} className="relative md:pr-10">
                  <div className="flex items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full border border-ink font-mono text-sm font-bold">{i + 1}</span>
                    <span aria-hidden className="hidden h-px flex-1 bg-line md:block" />
                  </div>
                  <p className="mt-5 font-mono text-base font-bold">flowretest {cmd}</p>
                  <p className="mt-2 max-w-sm leading-7 text-muted">{text}</p>
                </li>
              ))}
            </ol>
            <p className="mt-12 max-w-3xl border-l-2 border-accent pl-4 leading-7 text-muted">
              The runner contains no n8n code. It uses the official image of your version and reads your instance only through the public API. HTTP Request, Slack, HubSpot, Google Sheets, Airtable, Notion and OpenAI nodes are covered; database, mail and file writes never reach the network and are reported as skipped.
            </p>
          </div>
        </section>

        <section aria-labelledby="leaves" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 id="leaves" className="text-2xl font-bold tracking-tight sm:text-3xl">What leaves your machine</h2>
          <p className="mt-3 max-w-2xl text-lg leading-8 text-muted">
            Nothing, unless you run <code className="font-mono text-ink">flowretest upload</code>. Then only a redacted report, and the service refuses one that still holds a readable text value, email address or long number.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch">
            <div className="rounded-md border border-line bg-panel p-6">
              <h3 className="eyebrow">Stays in .flowretest/</h3>
              <ul className="mt-4 space-y-3">
                {STAYS.map((s) => (
                  <li key={s} className="flex gap-3 leading-6">
                    <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-ink" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div aria-hidden className="flex items-center justify-center font-mono text-xs text-muted md:flex-col md:gap-2">
              <span className="hidden md:block">upload</span>
              <span className="text-xl leading-none md:rotate-0">→</span>
            </div>
            <div className="rounded-md border border-dashed border-ink/40 p-6">
              <h3 className="eyebrow">Reaches the hosted service</h3>
              <dl className="mt-4 space-y-3">
                {LEAVES.map(([term, text]) => (
                  <div key={term} className="grid gap-x-4 leading-6 sm:grid-cols-[7rem_1fr]">
                    <dt className="font-bold">{term}</dt>
                    <dd className="text-muted">{text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
          <p className="mt-6 text-sm text-muted">
            <code className="font-mono">normalize.ignore</code> leaves a field out entirely. See <Link href="/legal/retention" className="underline hover:text-ink">data retention</Link> and the <Link href="/legal/dpa" className="underline hover:text-ink">DPA</Link>.
          </p>
        </section>

        <section aria-labelledby="upgrade" className="border-y border-line bg-panel">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-center">
            <div>
              <h2 id="upgrade" className="text-2xl font-bold tracking-tight sm:text-3xl">Before the n8n 3.0 upgrade</h2>
              <p className="mt-4 leading-7 text-muted">
                <code className="font-mono text-ink">upgrade-check</code> runs the same workflow on two n8n images and opens the plan with the engine differences: nodes that ran on one version only, item counts, output keys, new errors. Run it for every customer instance before you move it.
              </p>
              <CopyCommand className="mt-6" command="npx flowretest upgrade-check --engine-old 2.40.5 --engine-new 3.0.0" />
            </div>
            <figure>
              <div className={`overflow-x-auto rounded-md border border-line bg-bg`}>
                <table className="ledger text-sm">
                  <thead>
                    <tr>
                      <th scope="col">Customer instance</th>
                      <th scope="col">n8n 3.0.0</th>
                      <th scope="col">n8n next</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DRIFT.map(([name, from, a, b]) => (
                      <tr key={name}>
                        <th scope="row" className="px-4 py-2.5 text-left font-semibold">
                          {name}
                          <span className="block font-mono text-xs font-normal text-muted">runs {from}</span>
                        </th>
                        <td><StatusBadge status={a} /></td>
                        <td><StatusBadge status={b} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <figcaption className="mt-3 text-sm text-muted">Example of the drift matrix in the Agency plan: the latest upgrade check of every workflow, per target version.</figcaption>
            </figure>
          </div>
        </section>

        <section aria-labelledby="agencies" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div>
              <h2 id="agencies" className="text-2xl font-bold tracking-tight sm:text-3xl">For agencies with many customer instances</h2>
              <p className="mt-4 leading-7 text-muted">
                The runner is free and needs no account. The hosted layer keeps the redacted reports of your team and your customers in one place.
              </p>
              <p className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <span><span className="font-dot text-3xl font-black">79</span> <span className="text-sm text-muted">EUR a month, Team</span></span>
                <span><span className="font-dot text-3xl font-black">199</span> <span className="text-sm text-muted">EUR a month, Agency</span></span>
              </p>
              <p className="mt-2 text-sm text-muted">Excluding VAT{trial ? `. Both start with ${trial} days free` : ''}.</p>
              <Link href="/pricing" className={`${secondaryButtonClass} mt-6`}>Compare plans</Link>
            </div>
            <dl className="overflow-hidden rounded-md border border-line bg-panel">
              {HOSTED.map(([term, text, plan]) => (
                <div key={term} className="grid gap-x-6 gap-y-1 px-5 py-4 odd:bg-panel even:bg-band sm:grid-cols-[9rem_1fr]">
                  <dt className="font-bold">
                    {term}
                    {plan ? <span className="ml-2 align-middle font-mono text-2xs font-semibold tracking-wide text-accent uppercase">{plan}</span> : null}
                  </dt>
                  <dd className="leading-6 text-muted">{text}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="mt-14 grid gap-6 rounded-md bg-ink p-6 text-bg sm:p-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div>
              <h3 className="text-xl font-bold">Onboarding for agencies</h3>
              <p className="mt-2 max-w-2xl leading-7 opacity-80">
                We set FlowRetest up on your customer instances with you: fixtures for the workflows that matter, CI on your repository, the first upgrade check. 1,000 to 2,500 EUR depending on the number of instances, with six months of the Team plan included.
              </p>
            </div>
            {contact ? (
              <a href={`mailto:${contact}?subject=FlowRetest%20onboarding`} className="inline-flex min-h-10 items-center justify-center rounded-md bg-bg px-4 py-2 text-sm font-bold text-ink hover:bg-band">
                Write to {contact}
              </a>
            ) : null}
          </div>
        </section>
      </main>
    </PublicShell>
  );
}
