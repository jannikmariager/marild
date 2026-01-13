import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !session) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // Call Edge Function
    const { data, error } = await supabase.functions.invoke('ai_highlights_today');

    if (error) {
      console.error('Edge Function error:', error);
      
      // Check if it's a subscription error (403)
      if (error.message?.includes('subscription_required') || error.message?.includes('403')) {
        return NextResponse.json(
          { message: 'PRO subscription required' },
          { status: 403 }
        );
      }
      
      return NextResponse.json(
        { message: 'Failed to fetch AI highlights', error: error.message },
        { status: 500 }
      );
    }

    // Return the data
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=900, stale-while-revalidate=60', // 15 min cache
      },
    });
  } catch (error) {
    console.error('AI Highlights API error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
