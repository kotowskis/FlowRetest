import type { Block, LegalDocument } from '@/lib/legal/documents.ts';

/** Paths like /legal/retention inside the texts become links; the PDF prints them as they are. */
function linked(text: string): React.ReactNode {
  const parts = text.split(/(\/legal\/[a-z]+)/g);
  return parts.map((part, i) => (/^\/legal\/[a-z]+$/.test(part) ? <a key={i} href={part} className="underline">{part}</a> : part));
}

function BlockView({ block }: { block: Block }) {
  if ('p' in block) return <p className="mt-3">{linked(block.p)}</p>;
  if ('ul' in block) {
    return (
      <ul className="mt-3 list-disc space-y-1 pl-5">
        {block.ul.map((item) => <li key={item}>{linked(item)}</li>)}
      </ul>
    );
  }
  return (
    <div className="mt-3 overflow-x-auto rounded-md border border-line">
      <table className="ledger min-w-[36rem] text-sm">
        <thead>
          <tr>{block.table.head.map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {block.table.rows.map((row) => (
            <tr key={row.join('|')} className="align-top">
              {row.map((cell, i) => <td key={i} className="px-3 py-2">{linked(cell)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `complete`: the company details are set and only the legal review is missing. */
export function DraftNotice({ lang = 'en', complete = false }: { lang?: 'en' | 'pl'; complete?: boolean }) {
  const pl = complete
    ? 'Wersja robocza. Tekst czeka na przegląd prawny.'
    : 'Wersja robocza. Tekst czeka na przegląd prawny, a dane firmy nie są jeszcze uzupełnione.';
  const en = complete ? 'Draft. This text is waiting for legal review.' : 'Draft. This text is waiting for legal review and the company details are not filled in yet.';
  return (
    <p role="note" className="rounded-md border border-diff/40 bg-diff/10 px-4 py-3 text-sm">
      {lang === 'pl' ? `${pl} Opisuje, jak usługa działa dziś, ale nie jest jeszcze ofertą do podpisania.` : `${en} It describes how the service works today, but it is not an offer to sign.`}
    </p>
  );
}

export function LegalText({ doc }: { doc: LegalDocument }) {
  return (
    <div className="max-w-[70ch] text-[0.9375rem] leading-7">
      {doc.sections.map((s) => (
        <section key={s.heading} className="mt-10">
          <h2 className="text-lg font-bold tracking-tight">{s.heading}</h2>
          {s.blocks.map((b, i) => <BlockView key={i} block={b} />)}
        </section>
      ))}
    </div>
  );
}
