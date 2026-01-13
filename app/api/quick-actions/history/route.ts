import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    const userId = session.user.id;
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const limit = Math.min(Math.max(Number(limitParam) || 20, 1), 100);

    const { data, error } = await supabase
      .from('ai_quick_action_reports')
      .select('id, action, generated_at, headline, summary, result_json')
      .eq('user_id', userId)
      .order('generated_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    // result_json already matches QuickActionResult shape from backend
    const reports = (data || []).map((row) => row.result_json ?? {
      action: row.action,
      generatedAt: row.generated_at,
      headline: row.headline,
      summary: row.summary,
      insights: [],
      disclaimer: '',
    });

    return NextResponse.json({ reports });
  } catch (error: any) {
    console.error('[quick-actions/history GET] error', error);
    return NextResponse.json(
      { error: 'SYSTEM_ERROR', message: error.message || 'Failed to load history' },
      { status: 500 }
    );
  }
}
