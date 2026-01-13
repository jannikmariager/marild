import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

export async function GET() {
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
        return NextResponse.json(data, { status: 200 });
      }

      // Return the response as-is (including error responses) in production
      return NextResponse.json(data, { status: response.status });
    } catch (fetchError) {
      console.error('[Correction Risk API] Error calling Edge Function:', fetchError);
      
      // Return NO_DATA error - no mock data
      return NextResponse.json(
        {
          error: 'NO_DATA',
          message: 'No correction risk data available yet',
          access: {
            is_locked: !devForcePro,
            has_pro_access: devForcePro,
          },
        },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('Error fetching correction risk:', error);
    return NextResponse.json(
      {
        error: 'SERVER_ERROR',
        message: 'Failed to fetch correction risk data',
        access: {
          is_locked: true,
          has_pro_access: false,
        },
      },
      { status: 500 }
    );
  }
}
