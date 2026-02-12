import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// Note: Using a stable Stripe API version. The Stripe types may be pinned to an older
// version, so we cast here to avoid overly strict literal checking.
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabaseServer';
import { getSupabaseAdminClient } from '@/lib/supabaseAdmin';

const stripeSecret =
  process.env.STRIPE_SECRET_KEY ??
  (process.env.NODE_ENV === 'production' ? undefined : 'sk_test_placeholder');
const stripe =
  stripeSecret && stripeSecret.trim().length > 0
    ? new Stripe(stripeSecret.trim(), {
        apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
      })
    : null;
const DEFAULT_ALLOWED_ORIGINS = [
  'https://www.marild.com',
  'https://marild.com',
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
const ALLOWED_METHODS = 'POST,OPTIONS';
const ALLOWED_HEADERS = 'Authorization, Content-Type';

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

function requireStripe() {
  if (!stripe) {
    throw new Error('STRIPE_SECRET_KEY is not set');
  }
  return stripe;
}
function normalizeBaseUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return null;
  }
}

function resolveAppBaseUrl(request: NextRequest) {
  const configured = normalizeBaseUrl(process.env.FRONTEND_APP_BASE_URL ?? 'https://www.marild.com');
  if (configured) {
    return configured;
  }

  const originHeader = normalizeBaseUrl(request.headers.get('origin'));
  if (originHeader) {
    return originHeader;
  }

  return request.nextUrl.origin;
}

async function getUserFromAuthorizationHeader(request: NextRequest): Promise<User | null> {
  const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
    return null;
  }

  const token = authHeader.replace(/Bearer\s+/i, '').trim();
  if (!token) {
    return null;
  }

  const { client, error } = getSupabaseAdminClient();
  if (!client) {
    console.warn('[stripe/create-checkout] admin client unavailable', error);
    return null;
  }

  const {
    data: { user },
    error: adminError,
  } = await client.auth.getUser(token);

  if (adminError) {
    console.warn('[stripe/create-checkout] admin token lookup failed', adminError);
    return null;
  }

  return user ?? null;
}

async function getUserFromCookies(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    console.warn('[stripe/create-checkout] cookie session lookup failed', error);
    return null;
  }

  return user ?? null;
}

async function resolveRequestUser(request: NextRequest): Promise<User | null> {
  const tokenUser = await getUserFromAuthorizationHeader(request);
  if (tokenUser) {
    return tokenUser;
  }
  return getUserFromCookies();
}

export async function OPTIONS(request: NextRequest) {
  return applyCorsHeaders(request, new NextResponse(null, { status: 204 }));
}

export async function POST(req: NextRequest) {
  try {
    const user = await resolveRequestUser(req);
    if (!user || !user.email) {
      console.warn('[stripe/create-checkout] auth error or missing user');
      return jsonResponseWithCors(req, { error: 'Not authenticated' }, { status: 401 });
    }

    const rawPriceId = process.env.STRIPE_PRICE_PRO_MONTHLY;
    const priceId = rawPriceId?.trim() ?? (process.env.NODE_ENV === 'production' ? undefined : 'price_placeholder');
    if (!priceId) {
      return jsonResponseWithCors(req, { error: 'Stripe price not configured' }, { status: 500 });
    }

    const stripeClient = requireStripe();
    const appBase = resolveAppBaseUrl(req).replace(/\/$/, '');
    const session = await stripeClient.checkout.sessions.create({
      mode: 'subscription',
      customer_email: user.email,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${appBase}/app?checkout=success`,
      cancel_url: `${appBase}/pricing?checkout=cancelled`,
    });

    return jsonResponseWithCors(req, { id: session.id, url: session.url });
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

    const response = new NextResponse(
      JSON.stringify({ error: 'Stripe error', message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Stripe-Error': message,
        },
      },
    );
    return applyCorsHeaders(req, response);
  }
}
