import { NextResponse, type NextRequest } from 'next/server';
import { handleStripeEvent } from '@/lib/billing.ts';
import { stripeConfig, verifyStripeSignature, type StripeEvent } from '@/lib/stripe.ts';
import { createAdminClient } from '@/lib/supabase/admin.ts';

export const dynamic = 'force-dynamic';

/**
 * Stripe webhook: subscriptions and invoices. Every event re-reads its object from the API, so the payload is only a
 * pointer. A delivery that fails here answers 500 and Stripe retries it; a known event id answers 200 at once.
 */
export async function POST(request: NextRequest) {
  const config = stripeConfig();
  if (!config) return NextResponse.json({ error: 'billing not configured' }, { status: 404 });
  const raw = await request.text();
  if (!verifyStripeSignature(config.webhookSecret, raw, request.headers.get('stripe-signature'))) return NextResponse.json({ error: 'bad signature' }, { status: 400 });
  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch {
    return NextResponse.json({ error: 'body is not JSON' }, { status: 400 });
  }
  if (typeof event.id !== 'string' || typeof event.type !== 'string' || !event.data?.object) return NextResponse.json({ error: 'not a Stripe event' }, { status: 400 });

  const admin = createAdminClient();
  const seen = await admin.from('stripe_events').select('id').eq('id', event.id).maybeSingle();
  if (seen.data) return NextResponse.json({ received: true, duplicate: true });
  let detail: string;
  try {
    detail = await handleStripeEvent(admin, config, event);
  } catch (e) {
    console.error(`[stripe] ${event.type} ${event.id} failed:`, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'could not apply the event' }, { status: 500 });
  }
  await admin.from('stripe_events').upsert({ id: event.id, type: event.type, detail: detail.slice(0, 500) });
  return NextResponse.json({ received: true });
}
