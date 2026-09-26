import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env.ts';
import { planFeatures, type Plan } from '@/lib/plans.ts';
import { trialDays } from '@/lib/stripe.ts';
import type { Database } from '@/lib/database.types.ts';
import { OpGlyph, buttonClass, money, secondaryButtonClass } from '@/components/ui.tsx';
import { PublicShell, REPOSITORY_URL } from '@/components/public-shell.tsx';

export const metadata: Metadata = {
  title: 'Pricing',
  // The app is not indexed (root layout); the pricing page is the one page meant to be found.
  robots: { index: true },
  description: 'FlowRetest runner is free and open source. The hosted layer keeps redacted reports, approvals and checks for agencies: Team 79 EUR, Agency 199 EUR a month.',
};

// The plans come from the database the limits are enforced from, so the page cannot promise what the service refuses.
export const dynamic = 'force-dynamic';

async function plans() {
  const db = createClient<Database>(env.supabaseUrl(), env.supabaseAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.from('plans').select('*').order('sort');
  if (error) throw new Error(`plans: ${error.message}`);
  return data;
}

function Included({ yes }: { yes: boolean }) {
  return yes ? (
    <span className="text-pass">
      <OpGlyph op="+" />
      <span className="sr-only">Included</span>
    </span>
  ) : (
    <span className="text-sm text-muted">no</span>
  );
}

/** Rows of the comparison, read from the same plan rows the database enforces. */
const ROWS: Array<[string, (p: Plan) => React.ReactNode]> = [
  ['Workspaces (customer instances)', (p) => (p.workspaces === null ? 'Unlimited' : p.workspaces)],
  ['Seats', (p) => p.seats],
  ['Run history', (p) => `${p.retention_days} days`],
  ['Uploads per 24 hours', (p) => p.uploads_per_day.toLocaleString('en-US')],
  ['Email notifications', () => <Included yes />],
  ['GitHub checks and Slack', (p) => <Included yes={p.integrations} />],
  ['PDF record of each run', (p) => <Included yes={p.pdf_export} />],
  ['Engine drift matrix', (p) => <Included yes={p.drift_matrix} />],
];

function Price({ p }: { p: Plan }) {
  if (p.price_month_cents === 0) {
    return (
      <p>
        <span className="font-dot text-5xl leading-none font-black">0</span> <span className="text-sm text-muted">EUR</span>
        <span className="mt-1 block text-sm text-muted">no card</span>
      </p>
    );
  }
  return (
    <p>
      <span className="font-dot text-5xl leading-none font-black">{money(p.price_month_cents).replace(/ EUR$/, '')}</span> <span className="text-sm text-muted">EUR a month</span>
      <span className="mt-1 block text-sm text-muted">or {money(p.price_year_cents)} a year</span>
    </p>
  );
}

function cta(p: Plan, trial: number): string {
  if (p.price_month_cents === 0) return 'Start free';
  return trial ? `Try ${p.name} free for ${trial} days` : `Start with ${p.name}`;
}

const QUESTIONS: Array<[string, React.ReactNode]> = [
  [
    'What leaves our machines?',
    <>
      Only the redacted report that <code className="font-mono">flowretest upload</code> writes: the workflow and node names, the version file name, methods, hosts, URL templates and field names. Each text value becomes its type, length and a keyed hash; numbers below one million and true/false stay readable so you see what changed in an amount or a flag, and <code className="font-mono">normalize.ignore</code> leaves a field out entirely. Error messages come with emails, quoted text and long numbers replaced. From CI it also carries the repository, commit, branch and pull request number. Request bodies, recorded executions and credentials stay where the runner ran. The service refuses a report with a readable text value, email address or long number.
    </>,
  ],
  ['What is a workspace?', 'One customer n8n instance. An agency with twelve customers on their own instances needs twelve workspaces, which is the Agency plan.'],
  [
    'What happens when we downgrade or stop paying?',
    'Nothing is deleted on the day. The oldest workspaces up to the new limit keep taking uploads, the newer ones refuse them. Run history follows the new plan after 30 days of grace.',
  ],
  ['How do invoices and VAT work?', 'Stripe charges the card and issues the invoices. Prices exclude VAT. A business in Poland pays Polish VAT on top; a business elsewhere in the EU adds its VAT id at checkout and pays under reverse charge.'],
  [
    'Do you sign a data processing agreement?',
    <>
      Yes. An owner accepts the <Link href="/legal/dpa" className="underline">DPA</Link> for the organization in the app and downloads a PDF copy. Runs are kept for the plan&apos;s history or a shorter period you set; <Link href="/legal/retention" className="underline">data retention</Link> lists everything the service keeps.
    </>,
  ],
  ['Can we cancel any time?', 'Yes, on the billing page. The plan stays until the end of the paid month or year, then the organization moves to Free.'],
];

export default async function PricingPage() {
  const rows = await plans();
  const trial = trialDays();
  const featured = 'team';
  return (
    <PublicShell>
      <main className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <p className="eyebrow">Pricing</p>
        <h1 className="mt-3 max-w-3xl text-4xl leading-tight font-bold tracking-tight sm:text-5xl">The runner is free. You pay for the shared history.</h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
          The runner replays n8n workflows in a sealed sandbox and prints which HTTP calls a change would alter. It is open source, runs on your machine or in CI and needs no account. The hosted layer is for teams: report history per customer instance, approvals with names and dates, GitHub checks and notifications.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-md border border-dashed border-line px-5 py-4">
          <p>
            <span className="font-bold">Runner</span> <span className="text-muted">· MIT licence · no account, no telemetry · every command, upgrade-check included</span>
          </p>
          <a href={REPOSITORY_URL} className={secondaryButtonClass}>Get the runner</a>
        </div>

        {/* Wide screens: one comparison table, a column per plan. */}
        <div className="mt-8 hidden overflow-hidden rounded-md border border-line bg-panel md:block">
          <table className="w-full table-fixed border-collapse text-left">
            <caption className="sr-only">Hosted plans compared</caption>
            <colgroup>
              <col className="w-[28%]" />
              {rows.map((p) => <col key={p.id} className={p.id === featured ? 'bg-accent/5' : ''} />)}
            </colgroup>
            <thead>
              <tr className="align-top">
                <td className="p-6" />
                {rows.map((p) => (
                  <th key={p.id} scope="col" className={`border-l border-line p-6 font-normal ${p.id === featured ? 'shadow-[inset_0_3px_0_var(--color-accent)]' : ''}`}>
                    <span className="block text-lg font-bold">{p.name}</span>
                    <div className="mt-4"><Price p={p} /></div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([label, cell]) => (
                <tr key={label} className="even:bg-band">
                  <th scope="row" className="px-6 py-3 text-sm font-semibold">{label}</th>
                  {rows.map((p) => <td key={p.id} className="border-l border-line px-6 py-3 font-mono text-sm">{cell(p)}</td>)}
                </tr>
              ))}
              <tr>
                <td className="p-6" />
                {rows.map((p) => (
                  <td key={p.id} className="border-l border-line p-6">
                    <Link href="/login" className={`${p.id === featured ? buttonClass : secondaryButtonClass} w-full`}>{cta(p, trial)}</Link>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Narrow screens: one card per plan with the same lines. */}
        <div className="mt-8 space-y-4 md:hidden">
          {rows.map((p) => (
            <section key={p.id} aria-labelledby={`plan-${p.id}`} className={`rounded-md border bg-panel p-5 ${p.id === featured ? 'border-accent shadow-[inset_0_3px_0_var(--color-accent)]' : 'border-line'}`}>
              <h2 id={`plan-${p.id}`} className="text-lg font-bold">{p.name}</h2>
              <div className="mt-3"><Price p={p} /></div>
              <ul className="mt-5 space-y-2 text-sm">
                {planFeatures(p).map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="text-pass"><OpGlyph op="+" /></span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link href="/login" className={`${p.id === featured ? buttonClass : secondaryButtonClass} mt-6 w-full`}>{cta(p, trial)}</Link>
            </section>
          ))}
        </div>

        <p className="mt-5 max-w-3xl text-sm leading-6 text-muted">
          Prices exclude VAT. Yearly billing costs 20% less than twelve months.{trial ? ` Team and Agency start with ${trial} days free, once per organization; Stripe asks for a card and charges nothing if you cancel before the trial ends.` : ''} Paid plans are chosen on the billing page of an organization after signing in.
        </p>

        <section aria-labelledby="questions" className="mt-20 border-t border-line pt-10">
          <h2 id="questions" className="text-2xl font-bold tracking-tight">Questions</h2>
          <dl className="mt-8 divide-y divide-line">
            {QUESTIONS.map(([q, a]) => (
              <div key={q} className="grid gap-2 py-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
                <dt className="font-bold">{q}</dt>
                <dd className="leading-7 text-muted">{a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
    </PublicShell>
  );
}
