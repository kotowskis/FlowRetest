import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env.ts';
import { planFeatures } from '@/lib/plans.ts';
import type { Database } from '@/lib/database.types.ts';
import { buttonClass, money } from '@/components/ui.tsx';

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

const QUESTIONS: Array<[string, React.ReactNode]> = [
  [
    'What leaves our machines?',
    <>
      Only the redacted report that <code className="font-mono">flowretest upload</code> writes: node names, methods, hosts, URL templates, field names, and each value as its type, length and a salted hash. Request bodies, recorded executions and credentials stay where the runner ran. The service refuses a report that still carries values.
    </>,
  ],
  ['What is a workspace?', 'One customer n8n instance. An agency with twelve customers on their own instances needs twelve workspaces, which is the Agency plan.'],
  [
    'What happens when we downgrade or stop paying?',
    'Nothing is deleted on the day. The oldest workspaces up to the new limit keep taking uploads, the newer ones refuse them. Run history follows the new plan after 30 days of grace.',
  ],
  ['How do invoices and VAT work?', 'Stripe charges the card and issues the invoices. Prices exclude VAT; a business in the EU adds its VAT id at checkout and pays under reverse charge.'],
  ['Can we cancel any time?', 'Yes, on the billing page. The plan stays until the end of the paid month or year, then the organization moves to Free.'],
];

export default async function PricingPage() {
  const rows = await plans();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/pricing" className="font-mono text-sm font-semibold">flowretest</Link>
          <Link href="/login" className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink">Sign in</Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-3xl font-semibold">Pricing</h1>
        <p className="mt-3 max-w-3xl text-muted">
          The FlowRetest runner replays n8n workflows in a sealed sandbox and shows which HTTP calls a change would alter. It is open source (MIT), runs on your machine or in CI and needs no account. The hosted layer below is for teams: report history per customer instance, approvals with names and dates, GitHub checks and notifications.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {rows.map((p) => (
            <section key={p.id} className={`flex flex-col rounded-md border bg-panel p-5 ${p.id === 'team' ? 'border-accent' : 'border-line'}`}>
              <h2 className="text-lg font-semibold">{p.name}</h2>
              <p className="mt-2">
                {p.price_month_cents === 0 ? (
                  <span className="font-mono text-2xl">0 EUR</span>
                ) : (
                  <>
                    <span className="font-mono text-2xl">{money(p.price_month_cents)}</span> <span className="text-sm text-muted">a month</span>
                    <span className="block text-sm text-muted">or {money(p.price_year_cents)} a year</span>
                  </>
                )}
              </p>
              <ul className="mt-4 flex-1 space-y-1 text-sm text-muted">
                {planFeatures(p).map((f) => <li key={f}>{f}</li>)}
              </ul>
              <Link href="/login" className={`${buttonClass} mt-6 text-center`}>
                {p.price_month_cents === 0 ? 'Start free' : `Start with ${p.name}`}
              </Link>
            </section>
          ))}
        </div>
        <p className="mt-4 text-sm text-muted">Prices exclude VAT. Yearly billing costs 20% less than twelve months. Paid plans are chosen on the billing page of an organization after signing in.</p>

        <section className="mt-12 max-w-3xl">
          <h2 className="text-lg font-semibold">Questions</h2>
          <dl className="mt-4 space-y-5 text-sm">
            {QUESTIONS.map(([q, a]) => (
              <div key={q}>
                <dt className="font-medium">{q}</dt>
                <dd className="mt-1 text-muted">{a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
    </div>
  );
}
