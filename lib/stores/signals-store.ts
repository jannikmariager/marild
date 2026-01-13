import { create } from 'zustand';

interface SignalsFilters {
  symbol?: string;
  signalType?: 'buy' | 'sell' | 'neutral';
  timeframe?: string;
  freshOnly?: boolean;
  source?: 'user_requested' | 'performance_engine';
  onlyTradedByAi?: boolean;
}

interface SignalsStore {
  filters: SignalsFilters;
  setFilters: (newFilters: Partial<SignalsFilters>) => void;
  resetFilters: () => void;
}

export const useSignalsStore = create<SignalsStore>((set) => ({
  filters: {
    // Option A: keep the default view uncluttered
    freshOnly: true,
  },
  setFilters: (newFilters) =>
    set((state) => ({
      filters: { ...state.filters, ...newFilters },
    })),
  resetFilters: () => set({ filters: { freshOnly: true } }),
}));
