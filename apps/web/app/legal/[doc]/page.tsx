import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PublicShell } from '@/components/public-shell.tsx';
import { DraftNotice, LegalText } from '@/components/legal.tsx';
import { isLegalSlug, legalDocument, LEGAL_SLUGS } from '@/lib/legal/documents.ts';
import { provider } from '@/lib/legal/provider.ts';

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const { doc } = await params;
  if (!isLegalSlug(doc)) return {};
  const text = legalDocument(doc, provider());
  return { title: text.title, description: text.summary, robots: { index: !provider().draft } };
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  if (!isLegalSlug(doc)) notFound();
  const who = provider();
  const text = legalDocument(doc, who);
  const others = LEGAL_SLUGS.filter((s) => s !== doc).map((s) => ({ slug: s, title: legalDocument(s, who).title }));
  return (
    <PublicShell>
      <main className="mx-auto max-w-3xl px-4 py-10">
        {who.draft ? <DraftNotice /> : null}
        <h1 className="mt-6 text-3xl font-semibold">{text.title}</h1>
        <p className="mt-2 text-sm text-muted">
          {text.summary} Version of {text.version}.
        </p>
        {doc === 'dpa' ? (
          <p className="mt-4 text-sm">
            Owners accept this agreement for their organization on the Data page of the organization in the app. The acceptance records the company, the signer and the version, and gives a PDF copy.
          </p>
        ) : null}
        <LegalText doc={text} />
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
