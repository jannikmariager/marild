import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { getOrCreateStripeCustomer, createBillingPortalSession } from '@/lib/stripe';

export async function POST(request: NextRequest) {
  try {
    // Get session and user
    const supabase = await createClient();
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // Get user email
    const userEmail = session.user.email;
    if (!userEmail) {
      return NextResponse.json({ message: 'User email not found' }, { status: 400 });
    }

    // Get or create Stripe customer
    const customerId = await getOrCreateStripeCustomer(userEmail, session.user.id);

    // Create billing portal session
    const returnUrl = `${request.nextUrl.origin}/account`;
    const portalUrl = await createBillingPortalSession(customerId, returnUrl);

    return NextResponse.json({ url: portalUrl });
  } catch (error: unknown) {
    console.error('Billing portal error:', error);

    let message = 'Failed to create billing portal session';
    let debug = 'unknown error';

    if (error && typeof error === 'object') {
      const anyErr = error as { message?: string; name?: string };
      if (anyErr.message) {
        message = anyErr.message;
      }
      debug = `${anyErr.name ?? 'Error'}: ${anyErr.message ?? 'no message'}`;
    } else if (typeof error === 'string') {
      message = error;
      debug = error;
    }

    return new NextResponse(
      JSON.stringify({ message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Billing-Error': debug,
        },
      },
    );
  }
}
