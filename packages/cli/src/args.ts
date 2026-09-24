import { InvalidArgumentError } from 'commander';

/** A positive whole number; `--last abc` used to become NaN and pull nothing without saying why. */
export function positiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('expected a positive whole number');
  return n;
}

const SIZE_UNITS: Record<string, number> = { '': 1, b: 1, kb: 1024, k: 1024, mb: 1024 ** 2, m: 1024 ** 2, gb: 1024 ** 3, g: 1024 ** 3 };

/** Bytes from `5242880`, `5mb`, `512kb` or `1.5 MB`; `--max-size 5mb` used to become NaN, which turned the limit off. */
export function byteSize(value: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(value);
  const unit = SIZE_UNITS[(m?.[2] ?? '').toLowerCase()];
  if (!m || unit === undefined) throw new InvalidArgumentError('expected a size such as 5242880, 512kb or 5mb');
  return Math.round(Number(m[1]) * unit);
}

/** Comma-separated ids with spaces trimmed and empty entries dropped (`--cases "1, 2"`). */
export function idList(value: string): string[] {
  const ids = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) throw new InvalidArgumentError('expected at least one id');
  return ids;
}

export const PLAN_FORMATS = ['terminal', 'json', 'junit', 'md'] as const;
export type PlanFormatName = (typeof PLAN_FORMATS)[number];

/** Output formats; an unknown one is an error instead of being skipped silently. */
export function formatList(value: string): PlanFormatName[] {
  const formats = idList(value);
  const unknown = formats.filter((f) => !(PLAN_FORMATS as readonly string[]).includes(f));
  if (unknown.length) throw new InvalidArgumentError(`unknown format ${unknown.join(', ')}; use ${PLAN_FORMATS.join(', ')}`);
  return formats as PlanFormatName[];
}

/** Collects a repeatable option (`--stub a=x.json --stub b=y.json`). */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}
