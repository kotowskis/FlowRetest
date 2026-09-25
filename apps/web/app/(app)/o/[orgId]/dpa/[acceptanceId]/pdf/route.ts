import { NextResponse } from 'next/server';
import { assertId, session } from '@/lib/data.ts';
import { dpaDocument, isDpaLang } from '@/lib/legal/documents.ts';
import { provider } from '@/lib/legal/provider.ts';
import { exportFileName } from '@/lib/export.ts';
import { renderDpaRecord } from '@/lib/pdf/dpa-pdf.ts';

export const dynamic = 'force-dynamic';

const utc = (value: string) => `${new Date(value).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** PDF copy of one DPA acceptance (?lang=pl for the Polish text), for every member (RLS decides) and on every plan. */
export async function GET(request: Request, { params }: { params: Promise<{ orgId: string; acceptanceId: string }> }) {
  const { orgId, acceptanceId } = await params;
  const asked = new URL(request.url).searchParams.get('lang') ?? 'en';
  if (!isDpaLang(asked)) return NextResponse.json({ error: 'lang is en or pl' }, { status: 400 });
  assertId(orgId);
  assertId(acceptanceId);
  const { db } = await session();
  const [{ data: org }, { data: row }] = await Promise.all([
    db.from('organizations').select('name').eq('id', orgId).maybeSingle(),
    db.from('dpa_acceptances').select('*').eq('id', acceptanceId).eq('organization_id', orgId).maybeSingle(),
  ]);
  if (!org || !row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const doc = dpaDocument(row.version, provider(), asked);
  if (!doc) return NextResponse.json({ error: `the text of DPA version ${row.version} is not available` }, { status: 410 });
  const pdf = await renderDpaRecord({
    doc,
    provider: provider(),
    acceptance: {
      id: row.id,
      organizationName: org.name,
      companyName: row.company_name,
      companyAddress: row.company_address,
      companyId: row.company_id,
      signerName: row.signer_name,
      signerRole: row.signer_role,
      signerEmail: row.signer_email,
      acceptedAt: utc(row.accepted_at),
    },
    printedAt: utc(new Date().toISOString()),
    lang: asked,
  });
  const name = exportFileName(row.company_name, new Date(row.accepted_at)).replace(/^flowretest-/, 'flowretest-dpa-').replace(/\.jsonl$/, asked === 'en' ? '.pdf' : `-${asked}.pdf`);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'private, no-store' },
  });
}
