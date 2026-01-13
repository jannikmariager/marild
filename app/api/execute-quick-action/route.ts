import { createClient } from '@/lib/supabaseServer';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Get user session
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { action, symbols, timeframe } = body;

    // Call Supabase Edge Function
    // TODO: Fix execute_quick_action - currently returns 500, test_quick_action works
    const { data, error } = await supabase.functions.invoke('execute_quick_action', {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: { action, symbols, timeframe },
    });

    if (error) {
      console.error('Error calling execute_quick_action:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      
      // Handle PRO_REQUIRED error (402)
      if (error.message?.includes('PRO_REQUIRED') || error.message?.includes('402')) {
        return NextResponse.json(
          { 
            error: 'PRO_REQUIRED',
            message: 'This feature requires TradeLens Pro',
            locked: true,
          },
          { status: 402 }
        );
      }

      return NextResponse.json(
        { 
          error: error.message || 'Failed to execute action',
          details: error.toString(),
          context: error.context || null
        },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
