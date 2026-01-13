'use server';

/**
 * Manual trigger for signal evaluation
 * Can be called from admin dashboard to run evaluation on-demand
 */

export async function evaluateSignalsNow() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return { 
        success: false, 
        error: 'Supabase credentials not configured' 
      };
    }

    // Call the evaluate_signals_daily Edge Function
    const response = await fetch(
      `${supabaseUrl}/functions/v1/evaluate_signals_daily`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({}),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Failed to evaluate signals:', error);
      return { 
        success: false, 
        error: `HTTP ${response.status}: ${error}` 
      };
    }

    const result = await response.json();
    
    return { 
      success: true, 
      data: result 
    };
  } catch (error) {
    console.error('Error evaluating signals:', error);
    return { 
      success: false, 
      error: String(error) 
    };
  }
}
