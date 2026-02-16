import { createClient as createServiceClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { getOrCreateStripeCustomer, createBillingPortalSession } from '@/lib/stripe';

const getBearerToken = (request: NextRequest): string | null => {
  const raw = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

export async function POST(request: NextRequest) {
  try {
    // Prefer cookie session (Next app) but accept Bearer token for the Vite app.
    const authClient = await createClient();
    const {
      data: { user: cookieUser },
    } = await authClient.auth.getUser();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    let userId = cookieUser?.id ?? null;
    let userEmail = cookieUser?.email ?? null;

    if (!userId) {
      const token = getBearerToken(request);
      if (!token) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (!supabaseUrl || !supabaseServiceKey) {
        return NextResponse.json({ message: 'Server not configured' }, { status: 500 });
      }

      const supabaseAdmin = createServiceClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
      });
      const {
        data: { user },
      } = await supabaseAdmin.auth.getUser(token);

      if (!user?.id) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }

      userId = user.id;
      userEmail = user.email ?? null;
    }

    if (!userEmail) {
      return NextResponse.json({ message: 'User email not found' }, { status: 400 });
    }

    // Get or create Stripe customer
    const customerId = await getOrCreateStripeCustomer(userEmail, userId);

    // Create billing portal session
    // Always return to the *new* frontend app settings page.
    const appBaseUrl = (process.env.APP_BASE_URL ?? 'https://www.marild.com').replace(/\/$/, '');
    const returnUrl = `${appBaseUrl}/app/settings`;
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
