import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { PublicShell } from '@/components/public-shell.tsx';
import { DraftNotice, LegalText } from '@/components/legal.tsx';
import { DPA_VERSION, dpaDocument, isDpaLang, isLegalSlug, legalDocument, LEGAL_SLUGS, type DpaLang, type LegalDocument, type LegalSlug } from '@/lib/legal/documents.ts';
import { provider } from '@/lib/legal/provider.ts';
import { changeLine, type Notice } from '@/lib/subprocessor-notices.ts';
import { env } from '@/lib/env.ts';
import type { Database } from '@/lib/database.types.ts';

type Params = { params: Promise<{ doc: string }>; searchParams: Promise<{ lang?: string }> };

/** The page's text: the DPA in the language asked for (?lang=pl), everything else in English. */
function text(doc: LegalSlug, lang: string | undefined): { text: LegalDocument; lang: DpaLang } {
  const who = provider();
  if (doc === 'dpa' && isDpaLang(lang) && lang !== 'en') return { text: dpaDocument(DPA_VERSION, who, lang) as LegalDocument, lang };
  return { text: legalDocument(doc, who), lang: 'en' };
}

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const { doc } = await params;
  if (!isLegalSlug(doc)) return {};
  const { text: t } = text(doc, (await searchParams).lang);
  return { title: t.title, description: t.summary, robots: { index: !provider().draft } };
}

/** Announced sub-processor changes, newest first; public rows (RLS lets anyone read them). */
async function notices(): Promise<Notice[]> {
  const db = createClient<Database>(env.supabaseUrl(), env.supabaseAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.from('subprocessor_notices').select('*').order('effective_on', { ascending: false }).limit(50);
  if (error) throw new Error(`subprocessor notices: ${error.message}`);
  return (data ?? []) as unknown as Notice[];
}

export default async function LegalPage({ params, searchParams }: Params) {
  const { doc } = await params;
  if (!isLegalSlug(doc)) notFound();
  const who = provider();
  const { text: t, lang } = text(doc, (await searchParams).lang);
  const others = LEGAL_SLUGS.filter((s) => s !== doc).map((s) => ({ slug: s, title: legalDocument(s, who).title }));
  const announced = doc === 'subprocessors' ? await notices() : [];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <PublicShell>
      <main lang={lang} className="mx-auto max-w-3xl px-4 py-10">
        {who.draft ? <DraftNotice lang={lang} complete={who.complete} /> : null}
        {doc === 'dpa' ? (
          <p className="mt-6 text-sm">
            {lang === 'en' ? <span className="font-medium">English</span> : <Link href="/legal/dpa" className="underline">English</Link>}
            {' · '}
            {lang === 'pl' ? <span className="font-medium">Polski</span> : <Link href="/legal/dpa?lang=pl" className="underline">Polski</Link>}
          </p>
        ) : null}
        <h1 className="mt-6 text-3xl font-semibold">{t.title}</h1>
        <p className="mt-2 text-sm text-muted">
          {t.summary} {lang === 'pl' ? `Wersja z ${t.version}.` : `Version of ${t.version}.`}
        </p>
        {doc === 'dpa' ? (
          <p className="mt-4 text-sm">
            {lang === 'pl'
              ? 'Właściciel organizacji akceptuje umowę na stronie Data swojej organizacji w aplikacji. Akceptacja zapisuje firmę, osobę akceptującą i wersję oraz daje kopię PDF po angielsku i po polsku. W razie rozbieżności rozstrzyga wersja angielska.'
              : 'Owners accept this agreement for their organization on the Data page of the organization in the app. The acceptance records the company, the signer and the version, and gives a PDF copy in English and in Polish.'}
          </p>
        ) : null}
        {doc === 'subprocessors' ? (
          <section className="mt-8">
            <h2 className="text-base font-semibold">Announced changes</h2>
            {announced.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No changes are announced.</p>
            ) : (
              <ul className="mt-3 space-y-4 text-sm">
                {announced.map((n) => (
                  <li key={n.id} className="rounded-md border border-line bg-panel p-4">
                    <p className="font-medium">
                      {n.effective_on > today ? 'Takes effect' : 'Took effect'} on {n.effective_on}
                      <span className="font-normal text-muted"> · announced {n.announced_at.slice(0, 10)}</span>
                    </p>
                    <p className="mt-2">{n.summary}</p>
                    <ul className="mt-2 list-disc pl-5">
                      {n.changes.map((c, i) => <li key={i}>{changeLine(c)}</li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
        <LegalText doc={t} />
        <nav className="mt-12 border-t border-line pt-6 text-sm">
          <span className="text-muted">Also: </span>
          {others.map((o, i) => (
            <span key={o.slug}>
              {i > 0 ? ' · ' : ''}
              <Link href={`/legal/${o.slug}`} className="underline">{o.title}</Link>
            </span>
          ))}
        </nav>
      </main>
    </PublicShell>
  );
}
