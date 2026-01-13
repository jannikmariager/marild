import Stripe from 'stripe';

let stripeInstance: Stripe | null = null;

function getStripe() {
  if (!stripeInstance) {
    const rawKey = process.env.STRIPE_SECRET_KEY;
    if (!rawKey) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }

    const apiKey = rawKey.trim();
    if (!apiKey.startsWith('sk_')) {
      throw new Error('STRIPE_SECRET_KEY must be a Stripe secret key starting with "sk_"');
    }

    stripeInstance = new Stripe(apiKey, {
      apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
    });
  }
  return stripeInstance;
}

export async function createBillingPortalSession(
  customerId: string,
  returnUrl: string
): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session.url;
}

export async function getOrCreateStripeCustomer(
  email: string,
  userId: string
): Promise<string> {
  const stripe = getStripe();
  // Check if customer exists
  const customers = await stripe.customers.list({
    email,
    limit: 1,
  });

  if (customers.data.length > 0) {
    return customers.data[0].id;
  }

  // Create new customer
  const customer = await stripe.customers.create({
    email,
    metadata: {
      userId,
    },
  });

  return customer.id;
}
