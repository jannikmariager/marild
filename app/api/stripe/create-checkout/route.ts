import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// Note: Using a stable Stripe API version. The Stripe types may be pinned to an older
// version, so we cast here to avoid overly strict literal checking.
import { getUserFromRequest } from '@/app/api/_lib/entitlement';

const stripeSecret =
  process.env.STRIPE_SECRET_KEY ??
  (process.env.NODE_ENV === 'production' ? undefined : 'sk_test_placeholder');
const stripe =
  stripeSecret && stripeSecret.trim().length > 0
    ? new Stripe(stripeSecret.trim(), {
        apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
      })
    : null;

function requireStripe() {
  if (!stripe) {
    throw new Error('STRIPE_SECRET_KEY is not set');
  }
  return stripe;
}

export async function POST(req: NextRequest) {
  try {
    // This route is called both from the Next.js app (cookie session) and from the Vite frontend
    // (Bearer token via rewrite proxy). Support both.
    let user: { id: string; email: string | null } | null = null;
    try {
      user = await getUserFromRequest(req);
    } catch (resp: any) {
      if (resp instanceof Response) {
        // Normalize to the legacy error string the Vite UI expects.
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    if (!user?.id || !user.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const rawPriceId = process.env.STRIPE_PRICE_PRO_MONTHLY;
    const priceId = rawPriceId?.trim() ?? (process.env.NODE_ENV === 'production' ? undefined : 'price_placeholder');
    if (!priceId) {
      return NextResponse.json({ error: 'Stripe price not configured' }, { status: 500 });
    }

    const stripeClient = requireStripe();
    const session = await stripeClient.checkout.sessions.create({
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
