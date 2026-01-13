import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    // Call the Supabase Edge Function
    const { data, error } = await supabase.functions.invoke('ai_movers_commentary', {
      body: {},
    });

    if (error) {
      console.error('[AI Movers Summary API] Edge function error:', error);
      
      // Handle 403 (PRO required)
      if (error.message?.includes('403') || error.message?.includes('PRO')) {
        return NextResponse.json(
          {
            access: {
              is_locked: true,
              has_pro_access: false,
            },
            message: 'This feature requires a PRO subscription',
          },
          { status: 403 }
        );
      }

      throw error;
    }

    // If no data returned
    if (!data) {
      return NextResponse.json(
        { error: 'NO_DATA', message: 'No commentary available yet' },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[AI Movers Summary API] Error:', error);
    return NextResponse.json(
      {
        error: 'SYSTEM_ERROR',
        message: error.message || 'Failed to generate AI commentary',
      },
      { status: 500 }
    );
  }
}
