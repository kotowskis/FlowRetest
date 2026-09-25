/**
 * PDF record of one run: what the new version of the workflow would send, for change reviews and audits (ISO 27001
 * asks for evidence that changes were tested and approved). Built from the redacted report only.
 *
 * Written with createElement instead of JSX so node --test can render it without a build step.
 */
import { join } from 'node:path';
import { createElement as h, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { OP_LABEL, recordCases, type RecordCall, type RecordCase } from '../run-record.ts';

export interface RunRecordInput {
  runId: string;
  runUrl: string;
  status: string;
  mode: string;
  workflowName: string;
  n8nWorkflowId: string;
  workspaceName: string;
  organizationName: string;
  oldLabel: string;
  newLabel: string;
  engineImage: string;
  runner: string;
  generatedAt: string;
  uploadedAt: string;
  sealed: boolean;
  localRun: string | null;
  commit?: { repository: string; sha: string; pullRequest: number | null };
  coverage: { writeNodesTotal: number; writeNodesCaptured: number; replayedNodes: number; unsupported: string[]; stubbed?: string[] };
  summary: { cases: number; changed: number; added: number; removed: number; blocked: number } & Record<string, number>;
  acceptances: Array<{ acceptedBy: string; at: string; cases: string[]; message: string | null; appliedAt: string | null }>;
  cases: RecordCase[];
  printedAt: string;
}

let fontsReady = false;

/** Inter and Roboto Mono from assets/fonts (fontkit fails on the JetBrains Mono and IBM Plex Mono files of @expo-google-fonts): the 14 standard PDF fonts have no Polish letters, node names do. */
function registerFonts(dir = join(process.cwd(), 'assets', 'fonts')): void {
  if (fontsReady) return;
  Font.register({ family: 'Inter', fonts: [{ src: join(dir, 'Inter_400Regular.ttf') }, { src: join(dir, 'Inter_600SemiBold.ttf'), fontWeight: 600 }] });
  Font.register({ family: 'Mono', src: join(dir, 'RobotoMono_400Regular.ttf') });
  // Paths and hashes are long unbroken words; let them break every 24 characters instead of running off the page.
  Font.registerHyphenationCallback((word) => (word.length > 28 ? word.match(/.{1,24}/g) ?? [word] : [word]));
  fontsReady = true;
}

const STATUS_COLOR: Record<string, string> = { PASS: '#15803d', DIFF: '#b45309', ERROR: '#b91c1c', BLOCKED: '#6b7280', SKIPPED: '#6b7280' };
const OP_COLOR: Record<string, string> = { '+': '#15803d', '~': '#b45309', '-': '#b91c1c', '!': '#6b7280', '=': '#9ca3af' };
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 40, fontFamily: 'Inter', fontSize: 9, color: INK },
  kicker: { fontSize: 8, color: MUTED, letterSpacing: 0.6, textTransform: 'uppercase' },
  title: { fontSize: 18, fontWeight: 600, marginTop: 4, lineHeight: 1.25 },
  subtitle: { fontSize: 10, color: MUTED, marginTop: 4 },
  status: { fontSize: 11, fontWeight: 600, marginTop: 10 },
  meta: { marginTop: 12, borderTop: `1 solid ${LINE}` },
  metaRow: { flexDirection: 'row', borderBottom: `1 solid ${LINE}`, paddingVertical: 3 },
  metaKey: { width: 110, color: MUTED },
  metaValue: { flex: 1 },
  mono: { fontFamily: 'Mono', fontSize: 8 },
  h2: { fontSize: 12, fontWeight: 600, marginTop: 18, marginBottom: 6 },
  p: { marginBottom: 4 },
  small: { fontSize: 8, color: MUTED },
  caseHead: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#f3f4f6', paddingVertical: 4, paddingHorizontal: 6, marginTop: 12 },
  call: { marginTop: 6, paddingLeft: 6, borderLeft: `2 solid ${LINE}` },
  callLine: { flexDirection: 'row', gap: 6 },
  fieldRow: { flexDirection: 'row', borderBottom: `0.5 solid ${LINE}`, paddingVertical: 1.5 },
  fieldPath: { width: '38%', paddingRight: 6 },
  fieldSent: { flex: 1, paddingRight: 6 },
  fieldBefore: { width: '28%' },
  footerLeft: { position: 'absolute', bottom: 24, left: 40, fontSize: 7, color: MUTED },
  // A render-prop text has no content at layout time: it needs a width, and a lineHeight on the page makes react-pdf
  // 4.9 drop it altogether (the default line height is used everywhere else).
  footerRight: { position: 'absolute', bottom: 24, right: 40, width: 120, textAlign: 'right', fontSize: 7, color: MUTED },
});

// Text props are a union with SVG text; the View style type is the plain Style | Style[] this file uses.
type PdfStyle = ComponentProps<typeof View>['style'];
interface TextExtra {
  key?: string | number;
  fixed?: boolean;
}
const text = (style: PdfStyle, children: ReactNode, extra: TextExtra = {}) => h(Text, { style, ...extra } as ComponentProps<typeof Text>, children);

function metaRows(input: RunRecordInput): Array<[string, string]> {
  const cov = input.coverage;
  const pct = cov.writeNodesTotal === 0 ? 100 : Math.round((cov.writeNodesCaptured / cov.writeNodesTotal) * 100);
  return [
    ['Compared', input.mode === 'upgrade' ? `${input.oldLabel} -> ${input.newLabel} (engine upgrade)` : `old: ${input.oldLabel} -> new: ${input.newLabel}`],
    ['n8n workflow id', input.n8nWorkflowId],
    ['Engine', input.engineImage],
    ['Generated', `${input.generatedAt} by FlowRetest ${input.runner}`],
    ['Uploaded', input.uploadedAt],
    ...(input.commit ? [['Commit', `${input.commit.repository}@${input.commit.sha}${input.commit.pullRequest ? ` (pull request #${input.commit.pullRequest})` : ''}`] as [string, string]] : []),
    ['Sandbox', input.sealed ? 'sealed: internal network, no route out, checked before the run' : 'seal not verified'],
    ['Write coverage', `${pct}% (${cov.writeNodesCaptured} of ${cov.writeNodesTotal} write nodes captured, ${cov.replayedNodes} replayed from recordings${cov.unsupported.length ? `; unsupported: ${cov.unsupported.join(', ')}` : ''}${cov.stubbed?.length ? `; stubbed: ${cov.stubbed.join(', ')}` : ''})`],
    ['Run', input.runUrl],
    ...(input.localRun ? [['Local run', input.localRun] as [string, string]] : []),
  ];
}

function callView(call: RecordCall, i: number): ReactElement {
  const hasBefore = call.fields.some((f) => f.before !== undefined);
  return h(
    View,
    { key: i, style: s.call },
    h(View, { style: s.callLine, wrap: false, minPresenceAhead: 70 }, text([s.mono, { color: OP_COLOR[call.op] ?? INK }], call.op), text({ fontWeight: 600 }, call.node), text([s.mono, { flex: 1 }], call.request)),
    text(s.small, [OP_LABEL[call.op] ?? call.op, call.note ? ` · ${call.note}` : '', ...call.flags.map((f) => ` · ${f}`)].join('')),
    call.fields.length > 0
      ? h(
          View,
          { style: { marginTop: 3 } },
          h(View, { style: s.fieldRow, wrap: false, minPresenceAhead: 24 }, text([s.fieldPath, s.small], 'field'), text([s.fieldSent, s.small], 'sent'), hasBefore ? text([s.fieldBefore, s.small], 'before') : null),
          ...call.fields.map((f, j) =>
            h(
              View,
              { key: j, style: s.fieldRow, wrap: false },
              text([s.fieldPath, s.mono], f.path),
              text([s.fieldSent, s.mono, f.changed ? { color: OP_COLOR['~'] } : {}], f.sent),
              hasBefore ? text([s.fieldBefore, s.mono, { color: MUTED }], f.before ?? '') : null,
            ),
          ),
          call.more > 0 ? text([s.small, { marginTop: 2 }], `and ${call.more} more field${call.more === 1 ? '' : 's'}; the run page and the local report have all of them`) : null,
        )
      : null,
  );
}

function caseView(c: RecordCase): ReactElement {
  return h(
    View,
    { key: c.caseId },
    h(View, { style: s.caseHead, wrap: false, minPresenceAhead: 60 }, text({ fontWeight: 600 }, `Case ${c.caseId}`), text({ color: STATUS_COLOR[c.status] ?? INK, fontWeight: 600 }, `${c.status} · ${c.counts}`)),
    c.error ? text([s.mono, { color: STATUS_COLOR.ERROR, marginTop: 4 }], `execution failed: ${c.error}`) : null,
    ...c.notes.map((n, i) => text([s.small, { marginTop: 2 }], n, { key: `n${i}` })),
    c.calls.length === 0 && !c.error ? text([s.small, { marginTop: 4 }], 'No outbound calls.') : null,
    ...c.calls.map(callView),
  );
}

export function RunRecordDocument(input: RunRecordInput): ReactElement {
  const sum = input.summary;
  const counts = ['PASS', 'DIFF', 'ERROR', 'BLOCKED', 'SKIPPED'].filter((k) => sum[k]).map((k) => `${sum[k]} ${k}`).join(', ');
  return h(
    Document,
    { title: `FlowRetest record: ${input.workflowName}`, author: 'FlowRetest', subject: `Run ${input.runId}`, creator: 'FlowRetest', producer: 'FlowRetest' },
    h(
      Page,
      { size: 'A4', style: s.page, wrap: true },
      // Fixed elements repeat on every page; they come first so every page gets them.
      text(s.footerLeft, `Run ${input.runId} · printed ${input.printedAt}`, { fixed: true }),
      h(Text, { style: s.footerRight, fixed: true, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `page ${pageNumber} of ${totalPages}` }),
      text(s.kicker, 'FlowRetest · record of outbound calls'),
      text(s.title, input.workflowName),
      text(s.subtitle, `${input.organizationName} / ${input.workspaceName}`),
      text([s.status, { color: STATUS_COLOR[input.status] ?? INK }], `${input.status}: ${sum.cases} case${sum.cases === 1 ? '' : 's'}${counts ? ` (${counts})` : ''}; calls changed ${sum.changed}, added ${sum.added}, removed ${sum.removed}, blocked ${sum.blocked}`),
      h(View, { style: s.meta }, ...metaRows(input).map(([k, v]) => h(View, { key: k, style: s.metaRow, wrap: false }, text(s.metaKey, k), text([s.metaValue, k === 'Run' || k === 'Engine' || k === 'Commit' ? s.mono : {}], v)))),
      text(s.h2, 'Approval'),
      input.acceptances.length === 0
        ? text(s.p, 'Nobody accepted cases of this run in FlowRetest before this record was printed.')
        : h(
            View,
            null,
            ...input.acceptances.map((a, i) =>
              text(s.p, `${a.acceptedBy} accepted case ${a.cases.join(', ')} on ${a.at}${a.message ? `: "${a.message}"` : ''}${a.appliedAt ? `; baselines written ${a.appliedAt}` : '; baselines not yet written by a runner'}.`, { key: i }),
            ),
          ),
      text(s.h2, 'What the new version would send'),
      text(
        s.p,
        'Each case replays one recorded execution through the old and the new version in a sealed sandbox. Every outbound call of the new version is listed with the fields of its request. Signs: + new call, ~ changed, - no longer sent, ! blocked by the sandbox, = unchanged. For changed fields the value the old version sent is in the before column.',
      ),
      ...input.cases.map(caseView),
      text(s.h2, 'About the values in this record'),
      text(
        s.p,
        'Values were redacted on the machine that ran the test, before upload: a value appears as its type, its length and a hash that is equal only for equal values inside this run. Numbers, booleans and generated placeholders such as <uuid> are shown as they are. The request bodies themselves never left that machine; the full report stays there' +
          (input.localRun ? ` in the run directory ${input.localRun}.` : '.'),
      ),
    ),
  );
}

export async function renderRunRecord(input: RunRecordInput, fontDir?: string): Promise<Buffer> {
  registerFonts(fontDir);
  return renderToBuffer(RunRecordDocument(input) as Parameters<typeof renderToBuffer>[0]);
}

export { recordCases };
