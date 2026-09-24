import { createColors } from 'picocolors';

/**
 * Colours for the terminal plan, by line prefix: `~` changed, `+` added, `-` removed, `!` blocked, `E`/`x` errors
 * and failed expectations, `?` warnings, and the result line by status. Off with --no-color, NO_COLOR or a
 * non-terminal stdout (picocolors decides the last two).
 */
export function colorPlan(text: string, enabled: boolean): string {
  const c = createColors(enabled);
  if (!enabled) return text;
  return text
    .split('\n')
    .map((line) => {
      if (/^~ /.test(line)) return c.yellow(line);
      if (/^\+ /.test(line)) return c.green(line);
      if (/^- /.test(line)) return c.red(line);
      if (/^! /.test(line)) return c.magenta(line);
      if (/^(E|x) /.test(line)) return c.red(line);
      if (/^\? /.test(line)) return c.cyan(line);
      if (/^\s+! /.test(line)) return c.magenta(line);
      if (/^Result: PASS/.test(line)) return c.bold(c.green(line));
      if (/^Result: DIFF/.test(line)) return c.bold(c.yellow(line));
      if (/^Result: /.test(line)) return c.bold(c.red(line));
      if (/^(Plan|Engine differences)/.test(line)) return c.bold(line);
      return line;
    })
    .join('\n');
}
