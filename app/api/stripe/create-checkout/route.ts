import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// Note: Using a stable Stripe API version. The Stripe types may be pinned to an older
// version, so we cast here to avoid overly strict literal checking.
import { createClient } from '@/lib/supabaseServer';

const rawKey = process.env.STRIPE_SECRET_KEY;
if (!rawKey) {
  throw new Error('STRIPE_SECRET_KEY is not set');
}
const stripe = new Stripe(rawKey.trim(), {
  apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
});

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user || !user.email) {
      console.warn('[stripe/create-checkout] auth error or missing user', authError);
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const rawPriceId = process.env.STRIPE_PRICE_PRO_MONTHLY;
    const priceId = rawPriceId?.trim();
    if (!priceId) {
      return NextResponse.json({ error: 'Stripe price not configured' }, { status: 500 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: user.email,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${req.nextUrl.origin}/dashboard?checkout=success`,
      cancel_url: `${req.nextUrl.origin}/pricing?checkout=cancelled`,
    });

    return NextResponse.json({ id: session.id, url: session.url });
  } catch (err: unknown) {
    console.error('[stripe/create-checkout] error', err);

    let message = 'Stripe error';
    if (err && typeof err === 'object') {
      const anyErr = err as { message?: string; code?: string };
      if (anyErr.message) {
        message = anyErr.message;
      }
      if (anyErr.code) {
        message += ` (code: ${anyErr.code})`;
      }
    }

    return new NextResponse(
      JSON.stringify({ error: 'Stripe error', message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Stripe-Error': message,
        },
      },
    );
  }
}
