import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripeSecret =
  process.env.STRIPE_SECRET_KEY ??
  (process.env.NODE_ENV === 'production'
    ? undefined
    : 'sk_test_placeholder');
if (!stripeSecret) {
  throw new Error('STRIPE_SECRET_KEY is not set');
}
const stripe = new Stripe(stripeSecret.trim(), {
  // Use a stable Stripe API version; cast to avoid over-strict literal typing
  apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
});
const endpointSecret =
  process.env.STRIPE_WEBHOOK_SECRET ??
  (process.env.NODE_ENV === 'production'
    ? undefined
    : 'whsec_placeholder');
if (!endpointSecret) {
  throw new Error('STRIPE_WEBHOOK_SECRET is not set');
}
type SubscriptionTier = 'pro' | 'expired';

// Initialize Supabase with service role for admin operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

function mapStripeStatusToTier(status: Stripe.Subscription.Status): SubscriptionTier {
  const proStatuses: Stripe.Subscription.Status[] = ['active', 'trialing', 'past_due'];
  return proStatuses.includes(status) ? 'pro' : 'expired';
}

async function resolveAuthUser(email: string) {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    const { data, error } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1,
      email: normalizedEmail,
    } as any);
    const user = data?.users?.[0] ?? null;
    if (error || !user) {
      console.error('[stripe webhook] Could not resolve auth user for email', email, error);
      return null;
    }
    return user;
  } catch (err) {
    console.error('[stripe webhook] Error looking up auth user', err);
    return null;
  }
}

async function syncSubscriptionState(email: string, tier: SubscriptionTier, context: string) {
  const authUser = await resolveAuthUser(email);
  if (!authUser) {
    console.warn(`[stripe webhook] ${context}: skipping because auth user was not found for ${email}`);
    return;
  }

  const userId = authUser.id;
  const resolvedEmail = authUser.email ?? email;
  const nowIso = new Date().toISOString();

  // 1) Primary canonical profile: user_profile
  const profilePayload: Record<string, any> = {
    user_id: userId,
    email: resolvedEmail,
    subscription_tier: tier,
    updated_at: nowIso,
  };

  const { error: profileError } = await supabase
    .from('user_profile')
    .upsert(profilePayload, { onConflict: 'user_id' });

  if (profileError) {
    console.error(`[stripe webhook] ${context}: Failed to upsert user_profile`, profileError);
    throw profileError;
  }

  // 2) Mirror into subscription_status helper table
  const { error: subStatusError } = await supabase
    .from('subscription_status')
    .upsert(
      {
        user_id: userId,
        tier,
        renewed_at: nowIso,
      },
      { onConflict: 'user_id' }
    );

  if (subStatusError) {
    console.error(`[stripe webhook] ${context}: Failed to upsert subscription_status`, subStatusError);
    throw subStatusError;
  }


  console.log(`[stripe webhook] ${context}: subscription synced for ${resolvedEmail} (${tier})`);
}
export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        
        // Get customer email from session
        const customerEmail = session.customer_email || session.customer_details?.email;
        
        if (customerEmail && session.mode === 'subscription') {
          await syncSubscriptionState(customerEmail, 'pro', 'checkout.session.completed');
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        try {
          let customerEmail: string | null = null;
          if (typeof subscription.customer === 'string') {
            const customer = await stripe.customers.retrieve(subscription.customer);
            if ('email' in customer && customer.email) {
              customerEmail = customer.email;
            }
          } else if (
            subscription.customer &&
            typeof subscription.customer === 'object' &&
            'email' in subscription.customer &&
            subscription.customer.email
          ) {
            customerEmail = subscription.customer.email as string;
          }

          if (customerEmail) {
            const tier = mapStripeStatusToTier(subscription.status);
            await syncSubscriptionState(customerEmail, tier, event.type);
          } else {
            console.warn(`[stripe webhook] ${event.type}: no customer email found for subscription ${subscription.id}`);
          }
        } catch (err) {
          console.error('Error retrieving customer:', err);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        
        if (invoice.customer_email) {
          // Optionally downgrade or mark as payment failed
          console.warn(`Payment failed for ${invoice.customer_email}`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}
