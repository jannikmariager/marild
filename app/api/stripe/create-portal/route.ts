import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// Note: Using a stable Stripe API version. The Stripe types may be pinned to an older
// version, so we cast here to avoid overly strict literal checking.
import { createServerClient } from '@supabase/ssr';

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
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll: () => {},
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !user.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // In a fuller implementation we would store the Stripe customer ID on the user record.
    // For now we let Stripe look it up by email.
    const stripeClient = requireStripe();
    const sessions = await stripeClient.checkout.sessions.list({
      limit: 1,
      customer_details: { email: user.email },
    });

    const customerId = sessions.data[0]?.customer as string | undefined;

    if (!customerId) {
      return NextResponse.json({ error: 'No Stripe customer found' }, { status: 400 });
    }

    const portalSession = await stripeClient.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${req.nextUrl.origin}/account`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    console.error('[stripe/create-portal] error', err);
    return NextResponse.json({ error: 'Stripe error' }, { status: 500 });
  }
}
