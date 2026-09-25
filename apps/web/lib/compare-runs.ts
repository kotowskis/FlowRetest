/**
 * Two runs of one workflow side by side (plan section 11, report browser): per case, the status and counts in each,
 * and the calls whose outcome differs between them. Pure data from the redacted reports, tested without a page.
 */
import { FLAG_TEXT, type CaseDiff, type PlanEntry, type PlanReport } from '@flowretest/core';

export interface CaseCounts {
  status: string;
  changed: number;
  added: number;
  removed: number;
  blocked: number;
}

export interface CallChange {
  /** `Node · POST crm.example.com/contacts`, as the plan prints a call. */
  call: string;
  /** Plan symbol in each run (`=`, `~`, `+`, `-`, `!`); undefined when the run has no such call. */
  before?: string;
  after?: string;
  /** Flags present in the later run only, as sentences. */
  newFlags: string[];
}

export interface CaseComparison {
  caseId: string;
  before?: CaseCounts;
  after?: CaseCounts;
  calls: CallChange[];
  /** Nothing differs: same status, same calls with the same outcome and flags. */
  same: boolean;
}

function counts(c: CaseDiff): CaseCounts {
  return { status: c.status, changed: c.summary.changed, added: c.summary.added, removed: c.summary.removed, blocked: c.summary.blocked };
}

/** The same call made twice in a case is told apart by its occurrence. */
function keyed(entries: PlanEntry[]): Map<string, PlanEntry> {
  const seen = new Map<string, number>();
  const out = new Map<string, PlanEntry>();
  for (const e of entries) {
    const base = `${e.node} · ${e.method} ${e.host}${e.pathTemplate}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.set(n === 1 ? base : `${base} (#${n})`, e);
  }
  return out;
}

/** `before` is the earlier run, `after` the later one; cases in either run, in the order of the later one first. */
export function compareRuns(before: Pick<PlanReport, 'cases'>, after: Pick<PlanReport, 'cases'>): CaseComparison[] {
  const a = new Map(before.cases.map((c) => [c.caseId, c]));
  const b = new Map(after.cases.map((c) => [c.caseId, c]));
  const ids = [...new Set([...b.keys(), ...a.keys()])];
  return ids.map((caseId) => {
    const ca = a.get(caseId);
    const cb = b.get(caseId);
    const ea = keyed(ca?.entries ?? []);
    const eb = keyed(cb?.entries ?? []);
    const calls: CallChange[] = [];
    for (const call of new Set([...eb.keys(), ...ea.keys()])) {
      const x = ea.get(call);
      const y = eb.get(call);
      const newFlags = (y?.flags ?? []).filter((f) => !(x?.flags ?? []).includes(f)).map((f) => FLAG_TEXT[f] ?? f);
      if (x?.op !== y?.op || newFlags.length > 0) calls.push({ call, before: x?.op, after: y?.op, newFlags });
    }
    const same = !!ca && !!cb && ca.status === cb.status && calls.length === 0;
    return { caseId, before: ca ? counts(ca) : undefined, after: cb ? counts(cb) : undefined, calls, same };
  });
}
