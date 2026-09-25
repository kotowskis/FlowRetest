/** One line of the organization export: a JSON object with the kind of row and the row as stored. */
export interface ExportLine {
  type: string;
  data: unknown;
}

export function exportLine(line: ExportLine): string {
  return `${JSON.stringify(line)}\n`;
}

/** `flowretest-acme-automation-2026-09-25.jsonl`; ASCII only, so every client keeps the name. */
export function exportFileName(orgName: string, at: Date): string {
  const slug = orgName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `flowretest-${slug || 'organization'}-${at.toISOString().slice(0, 10)}.jsonl`;
}
