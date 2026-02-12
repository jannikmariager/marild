import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '@/lib/supabaseAdmin';

const ACTIVE_STATUSES: Stripe.Subscription.Status[] = ['active', 'trialing'];
const STRIPE_API_VERSION = '2024-06-20' as Stripe.LatestApiVersion;
const DEFAULT_ALLOWED_ORIGINS = [
  'https://www.marild.com',
  'https://marild.vercel.app',
  'http://localhost:3000',
  'http://localhost:4173',
  'http://localhost:5173',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:8080',
];
const PREVIEW_ORIGIN_SUFFIXES = ['.vercel.app'];
const ALLOWED_METHODS = 'GET,OPTIONS';
const ALLOWED_HEADERS = 'Authorization, Content-Type, Supabase-Access-Token';

let stripeInstance: Stripe | null = null;

function getStripeClient(): Stripe | null {
  if (stripeInstance) {
    return stripeInstance;
  }

  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) {
    return null;
  }

  stripeInstance = new Stripe(secret, {
    apiVersion: STRIPE_API_VERSION,
  });

  return stripeInstance;
}

function parseEnvAllowedOrigins() {
  return process.env.CORS_ALLOWED_ORIGINS?.split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function isOriginAllowed(origin: string) {
  const envOrigins = parseEnvAllowedOrigins();
  const whitelist = new Set([...DEFAULT_ALLOWED_ORIGINS, ...(envOrigins ?? [])]);

  if (whitelist.has(origin)) {
    return true;
  }

  return PREVIEW_ORIGIN_SUFFIXES.some((suffix) => origin.endsWith(suffix));
}

function applyCorsHeaders(request: NextRequest, response: NextResponse) {
  const origin = request.headers.get('origin') ?? request.headers.get('Origin');

  if (origin && isOriginAllowed(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.append('Vary', 'Origin');
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }

  response.headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
  response.headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  response.headers.set('Access-Control-Max-Age', '600');

  return response;
}

function jsonResponseWithCors(request: NextRequest, data: Record<string, unknown>, init?: ResponseInit) {
  return applyCorsHeaders(request, NextResponse.json(data, init));
}

function unauthorized(request: NextRequest, message = 'Unauthorized') {
  return jsonResponseWithCors(request, { error: message }, { status: 401 });
}

function serverError(request: NextRequest, message = 'Server not configured') {
  return jsonResponseWithCors(request, { error: message }, { status: 500 });
}

async function resolveStripeCustomerId(
  supabaseAdmin: SupabaseClient,
  stripe: Stripe,
  userId: string,
  email?: string | null,
) {
  // Try to read from user_profile stripe_customer_id if the column exists.
  try {
    const { data, error } = await supabaseAdmin
      .from('user_profile')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!error && data && typeof data.stripe_customer_id === 'string' && data.stripe_customer_id.length > 0) {
      return data.stripe_customer_id as string;
    }
  } catch (err) {
    console.warn('[billing/entitlement] Unable to read stripe_customer_id from user_profile:', err);
  }

  if (!email) {
    return null;
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const search = await stripe.customers.search({
      query: `email:'${normalizedEmail}'`,
      limit: 1,
    });

    return search.data[0]?.id ?? null;
  } catch (err) {
    console.error('[billing/entitlement] Stripe customer search failed:', err);
    return null;
  }
}

async function findActiveSubscription(stripe: Stripe, customerId: string) {
  for (const status of ACTIVE_STATUSES) {
    const { data } = await stripe.subscriptions.list({
      customer: customerId,
      status,
      limit: 1,
      expand: ['data.items.data.price', 'data.plan'],
    });

    if (data.length > 0) {
      return data[0];
    }
  }

  return null;
}

function derivePlan(sub: Stripe.Subscription | null): string | undefined {
  if (!sub) return undefined;

  const price = sub.items.data[0]?.price;
  const nickname = price?.nickname ?? null;
  let productName: string | null = null;

  const product = price?.product;
  if (product && typeof product === 'object' && 'name' in product && typeof product.name === 'string') {
    productName = product.name;
  }

  const metadataPlan = sub.metadata?.plan ?? null;
  return (nickname || productName || metadataPlan || 'pro').toString();
}

export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest) {
  return applyCorsHeaders(request, new NextResponse(null, { status: 204 }));
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');

  if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
    return unauthorized(request);
  }

  const token = authHeader.replace(/Bearer\s+/i, '').trim();
  if (!token) {
    return unauthorized(request);
  }

  const { client: supabaseAdmin, error: supabaseError } = getSupabaseAdminClient();
  if (!supabaseAdmin) {
    return serverError(request, supabaseError ?? 'Supabase admin client unavailable');
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return serverError(request, 'Stripe not configured');
  }

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return unauthorized(request);
  }

  const customerId = await resolveStripeCustomerId(supabaseAdmin, stripe, user.id, user.email);
  if (!customerId) {
    return jsonResponseWithCors(request, { active: false });
  }

  try {
    const activeSub = await findActiveSubscription(stripe, customerId);
    if (!activeSub) {
      return jsonResponseWithCors(request, { active: false });
    }

    return jsonResponseWithCors(request, {
      active: true,
      plan: derivePlan(activeSub) ?? 'pro',
      status: activeSub.status,
    });
  } catch (err) {
    console.error('[billing/entitlement] Stripe subscription lookup failed:', err);
    return jsonResponseWithCors(
      request,
      { active: false, error: 'Unable to verify subscription' },
      { status: 200 },
    );
  }
}
