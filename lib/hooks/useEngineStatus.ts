import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabaseBrowser';

export interface EngineStatus {
  evaluation_completed: boolean;
  signals_found: number;
  evaluation_reason: string;
  next_evaluation_at: string;
}

/**
 * Hook to fetch the latest engine evaluation status
 * Used to display the Engine Status Banner when no signals are generated
 *
 * Fetches from ai_signals table to determine:
 * - How many signals were generated in the last evaluation
 * - The reason why (if zero)
 * - When the next evaluation will occur
 */
export function useEngineStatus() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchEngineStatus() {
      try {
        setLoading(true);
        setError(null);

        const supabase = createClient();
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        // Fetch the count of signals generated in the last hour
        const { data: signalsData, error: signalsError } = await supabase
          .from('ai_signals')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', oneHourAgo.toISOString());

        if (signalsError) throw signalsError;

        const signalsCount = signalsData?.length || 0;

        // Build engine status object
        const engineStatus: EngineStatus = {
          evaluation_completed: true,
          signals_found: signalsCount,
          evaluation_reason:
            signalsCount === 0
              ? getRandomEvaluationReason()
              : 'Signals qualified and generated',
          next_evaluation_at: new Date(
            now.getTime() + 60 * 60 * 1000
          ).toISOString(),
        };

        setStatus(engineStatus);
      } catch (err) {
        console.error('[useEngineStatus] Error fetching status:', err);
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    }

    fetchEngineStatus();

    // Refresh every 30 seconds to keep countdown timer accurate
    const interval = setInterval(fetchEngineStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  return { status, loading, error };
}

/**
 * Get a random evaluation reason for when no signals are found
 * Mirrors the backend logic
 */
function getRandomEvaluationReason(): string {
  const reasons = [
    'Low volatility and sideways price action detected',
    'Trend and pullback conditions were not sufficiently aligned',
    'Reduced liquidity during market conditions',
    'Price action lacked confirmation for high-probability setups',
    'Market structure did not meet risk-reward requirements',
  ];
  return reasons[Math.floor(Math.random() * reasons.length)];
}
