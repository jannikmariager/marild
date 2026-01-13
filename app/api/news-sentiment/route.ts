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
    const { symbol, limit = 20 } = body;

    // Call Supabase Edge Function
    const { data, error } = await supabase.functions.invoke('news_sentiment_analyzer', {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: { symbol, limit },
    });

    if (error) {
      console.error('Error calling news_sentiment_analyzer:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to fetch news sentiment' },
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
