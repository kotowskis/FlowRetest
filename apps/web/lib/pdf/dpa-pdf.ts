/**
 * PDF copy of an accepted Data Processing Agreement: the parties and the acceptance record on the first page, then
 * the text of the accepted version from lib/legal/documents.ts, so the copy matches what /legal/dpa showed.
 *
 * Written with createElement instead of JSX so node --test can render it without a build step.
 */
import { createElement as h, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import type { Block, LegalDocument } from '../legal/documents.ts';
import type { Provider } from '../legal/provider.ts';
import { registerFonts } from './run-record-pdf.ts';

export interface DpaRecordInput {
  doc: LegalDocument;
  provider: Provider;
  acceptance: {
    id: string;
    organizationName: string;
    companyName: string;
    companyAddress: string;
    companyId: string | null;
    signerName: string;
    signerRole: string;
    signerEmail: string;
    acceptedAt: string;
  };
  printedAt: string;
}

const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 48, fontFamily: 'Inter', fontSize: 9.5, color: INK },
  kicker: { fontSize: 8, color: MUTED, letterSpacing: 0.6, textTransform: 'uppercase' },
  title: { fontSize: 18, fontWeight: 600, marginTop: 4 },
  draft: { marginTop: 10, padding: 6, border: '1 solid #b45309', color: '#b45309', fontSize: 8.5 },
  meta: { marginTop: 14, borderTop: `1 solid ${LINE}` },
  metaRow: { flexDirection: 'row', borderBottom: `1 solid ${LINE}`, paddingVertical: 3 },
  metaKey: { width: 140, paddingRight: 6, color: MUTED },
  metaValue: { flex: 1 },
  h2: { fontSize: 11, fontWeight: 600, marginTop: 14, marginBottom: 4 },
  p: { marginBottom: 5 },
  li: { flexDirection: 'row', marginBottom: 3 },
  bullet: { width: 10 },
  liText: { flex: 1 },
  table: { marginTop: 2, marginBottom: 6, borderTop: `1 solid ${LINE}` },
  tr: { flexDirection: 'row', borderBottom: `0.5 solid ${LINE}`, paddingVertical: 2 },
  th: { flex: 1, paddingRight: 6, fontSize: 8, color: MUTED },
  td: { flex: 1, paddingRight: 6, fontSize: 8.5 },
  footerLeft: { position: 'absolute', bottom: 24, left: 48, fontSize: 7, color: MUTED },
  // Render-prop text needs a width and no lineHeight on the page (see run-record-pdf.ts).
  footerRight: { position: 'absolute', bottom: 24, right: 48, width: 120, textAlign: 'right', fontSize: 7, color: MUTED },
});

type PdfStyle = ComponentProps<typeof View>['style'];
const text = (style: PdfStyle, children: ReactNode, extra: { key?: string | number; fixed?: boolean } = {}) => h(Text, { style, ...extra } as ComponentProps<typeof Text>, children);

function block(b: Block, key: number): ReactElement {
  if ('p' in b) return text(s.p, b.p, { key });
  if ('ul' in b) return h(View, { key }, ...b.ul.map((item, i) => h(View, { key: i, style: s.li, wrap: false }, text(s.bullet, '•'), text(s.liText, item))));
  return h(
    View,
    { key, style: s.table },
    h(View, { style: s.tr, wrap: false }, ...b.table.head.map((c, i) => text(s.th, c, { key: i }))),
    ...b.table.rows.map((row, r) => h(View, { key: r, style: s.tr, wrap: false }, ...row.map((c, i) => text(s.td, c, { key: i })))),
  );
}

export function DpaRecordDocument(input: DpaRecordInput): ReactElement {
  const a = input.acceptance;
  const p = input.provider;
  const rows: Array<[string, string]> = [
    ['Customer', [a.companyName, a.companyAddress, a.companyId].filter(Boolean).join(', ')],
    ['Organization in FlowRetest', a.organizationName],
    ['Accepted by', `${a.signerName}, ${a.signerRole} (${a.signerEmail})`],
    ['Accepted at', a.acceptedAt],
    ['Provider', `${p.name}, ${p.address}, ${p.companyId}`],
    ['Version', input.doc.version],
    ['Record', a.id],
  ];
  return h(
    Document,
    { title: `${input.doc.title}: ${a.companyName}`, author: 'FlowRetest', subject: `DPA version ${input.doc.version}`, creator: 'FlowRetest', producer: 'FlowRetest' },
    h(
      Page,
      { size: 'A4', style: s.page, wrap: true },
      text(s.footerLeft, `DPA ${input.doc.version} · ${a.companyName} · printed ${input.printedAt}`, { fixed: true }),
      h(Text, { style: s.footerRight, fixed: true, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `page ${pageNumber} of ${totalPages}` }),
      text(s.kicker, 'FlowRetest · accepted agreement'),
      text(s.title, input.doc.title),
      p.draft ? text(s.draft, 'Draft: the text awaits legal review and the provider details are not filled in yet.') : null,
      h(View, { style: s.meta }, ...rows.map(([k, v]) => h(View, { key: k, style: s.metaRow, wrap: false }, text(s.metaKey, k), text(s.metaValue, v)))),
      text(
        [s.p, { marginTop: 10 }],
        `The Customer accepted this agreement electronically in the FlowRetest application. The person named above confirmed that they may accept agreements for the Customer. The text below is the version accepted.`,
      ),
      ...input.doc.sections.map((sec, i) => h(View, { key: i }, text(s.h2, sec.heading), ...sec.blocks.map(block))),
    ),
  );
}

export async function renderDpaRecord(input: DpaRecordInput, fontDir?: string): Promise<Buffer> {
  registerFonts(fontDir);
  return renderToBuffer(DpaRecordDocument(input) as Parameters<typeof renderToBuffer>[0]);
}
