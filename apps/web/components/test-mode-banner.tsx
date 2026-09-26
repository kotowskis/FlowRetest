import { testMode, warnIfTestModeIgnored } from '@/lib/test-mode.ts';

/** A strip on every page of a server in test mode (lib/test-mode.ts), so nobody mistakes the data for real. */
export function TestModeBanner() {
  if (!testMode()) {
    warnIfTestModeIgnored();
    return null;
  }
  const mailpit = process.env.MAILPIT_URL;
  return (
    <div role="note" className="border-b border-diff/40 bg-diff/10 px-4 py-1.5 text-center text-xs text-ink">
      <strong className="font-semibold text-diff">Test mode.</strong> Seeded test data; Stripe, GitHub and Slack are local fakes
      {mailpit ? (
        <>
          ; mail goes to{' '}
          <a href={mailpit} className="underline">
            Mailpit
          </a>
        </>
      ) : null}
      .
    </div>
  );
}
