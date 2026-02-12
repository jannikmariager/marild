import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

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

export async function OPTIONS(request: NextRequest) {
  return applyCorsHeaders(request, new NextResponse(null, { status: 204 }));
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

    // Check DEV_FORCE_PRO
    const devForcePro = process.env.NEXT_PUBLIC_DEV_FORCE_PRO === 'true';

    // Get session
    const { data: session } = await supabase.auth.getSession();

    try {
      // Call Supabase Edge Function
      const response = await fetch(`${supabaseUrl}/functions/v1/correction_risk_latest`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session?.session?.access_token || ''}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      // Override locked state if DEV_FORCE_PRO is enabled
      if (devForcePro && data.access) {
        data.access.is_locked = false;
        data.access.has_pro_access = true;
      }

      // In DEV, never surface auth/edge errors as non-2xx – this breaks the dashboard UX
      if (devForcePro && !response.ok) {
        console.warn('[Correction Risk API] Edge function returned non-2xx in dev, normalising to 200:', {
          status: response.status,
          body: data,
        });
        return jsonWithCors(request, data, { status: 200 });
      }

      // Return the response as-is (including error responses) in production
      return jsonWithCors(request, data, { status: response.status });
    } catch (fetchError) {
      console.error('[Correction Risk API] Error calling Edge Function:', fetchError);

      // Return NO_DATA error - no mock data
      return jsonWithCors(
        request,
        {
          error: 'NO_DATA',
          message: 'No correction risk data available yet',
          access: {
            is_locked: !devForcePro,
            has_pro_access: devForcePro,
          },
        },
        { status: 404 },
      );
    }
  } catch (error) {
    console.error('Error fetching correction risk:', error);
    return jsonWithCors(
      request,
      {
        error: 'SERVER_ERROR',
        message: 'Failed to fetch correction risk data',
        access: {
          is_locked: true,
          has_pro_access: false,
        },
      },
      { status: 500 },
    );
  }
}
