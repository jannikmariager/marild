import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabaseAdmin';

const DEV_FORCE_PRO = process.env.NEXT_PUBLIC_DEV_FORCE_PRO === 'true';
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

const successPayload = { latest_signal_time: null, count: 0 };

function parseEnvAllowedOrigins() {
  return process.env.CORS_ALLOWED_ORIGINS?.split(',').map((value) => value.trim()).filter(Boolean);
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

function jsonWithCors(request: NextRequest, data: Record<string, unknown>, init?: ResponseInit) {
  return applyCorsHeaders(request, NextResponse.json(data, init));
}

function getBearerToken(request: NextRequest) {
  const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, '').trim();
  }
  const supabaseHeader = request.headers.get('Supabase-Access-Token');
  return supabaseHeader?.trim() ?? null;
}

export async function OPTIONS(request: NextRequest) {
  return applyCorsHeaders(request, new NextResponse(null, { status: 204 }));
}

export async function GET(request: NextRequest) {
  try {
    const { client: supabaseAdmin, error: adminError } = getSupabaseAdminClient();
    if (!supabaseAdmin) {
      console.error('[Check New Signals API] Supabase admin missing:', adminError);
      return jsonWithCors(request, successPayload, { status: 200 });
    }

    let isPro = true;

    if (!DEV_FORCE_PRO) {
      const token = getBearerToken(request);
      if (!token) {
        return jsonWithCors(request, successPayload, { status: 200 });
      }

      const {
        data: { user },
        error: userError,
      } = await supabaseAdmin.auth.getUser(token);

      if (userError || !user) {
        return jsonWithCors(request, successPayload, { status: 200 });
      }

      const { data: subStatus, error: subError } = await supabaseAdmin
        .from('subscription_status')
        .select('tier')
        .eq('user_id', user.id)
        .maybeSingle();

      if (subError) {
        console.error('[Check New Signals API] subscription lookup failed:', subError);
        return jsonWithCors(request, successPayload, { status: 200 });
      }

      isPro = subStatus?.tier === 'pro';
    }

    if (!isPro) {
      return jsonWithCors(request, successPayload, { status: 200 });
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: recentSignals, error } = await supabaseAdmin
      .from('ai_signals')
      .select('created_at')
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Check New Signals API] query error:', error);
      return jsonWithCors(request, successPayload, { status: 200 });
    }

    if (!recentSignals || recentSignals.length === 0) {
      return jsonWithCors(request, successPayload, { status: 200 });
    }

    return jsonWithCors(request, {
      latest_signal_time: recentSignals[0].created_at,
      count: recentSignals.length,
    });
  } catch (error: any) {
    console.error('[Check New Signals API] Error:', error);
    return jsonWithCors(request, successPayload, { status: 200 });
  }
}
