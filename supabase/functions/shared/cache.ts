/**
 * Postgres-based caching layer
 * Stores market data with expiration timestamps
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface CacheEntry {
  id: string;
  data: any;
  expires_at: string;
  created_at: string;
}

export class CacheManager {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Get cached data if not expired
   */
  async get(key: string): Promise<any | null> {
    try {
      const { data, error } = await this.supabase
        .from('market_cache')
        .select('data, expires_at')
        .eq('id', key)
        .single();

      if (error || !data) {
        return null;
      }

      // Check if expired
      const expiresAt = new Date(data.expires_at);
      if (expiresAt < new Date()) {
        // Expired - delete it
        await this.delete(key);
        return null;
      }

      return data.data;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  /**
   * Set cache with TTL in seconds
   */
  async set(key: string, data: any, ttlSeconds: number): Promise<void> {
    try {
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + ttlSeconds);

      const { error } = await this.supabase
        .from('market_cache')
        .upsert({
          id: key,
          data,
          expires_at: expiresAt.toISOString(),
          created_at: new Date().toISOString(),
        }, {
          onConflict: 'id',
        });

      if (error) {
        console.error('Cache set error:', error);
      }
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  /**
   * Delete cache entry
   */
  async delete(key: string): Promise<void> {
    try {
      await this.supabase
        .from('market_cache')
        .delete()
        .eq('id', key);
    } catch (error) {
      console.error('Cache delete error:', error);
    }
  }

  /**
   * Get stale cache (up to 24 hours old) for fallback
   */
  async getStale(key: string): Promise<any | null> {
    try {
      const { data, error } = await this.supabase
        .from('market_cache')
        .select('data, expires_at')
        .eq('id', key)
        .single();

      if (error || !data) {
        return null;
      }

      // Check if not older than 24 hours
      const expiresAt = new Date(data.expires_at);
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      if (expiresAt < twentyFourHoursAgo) {
        return null;
      }

      return { ...data.data, stale: true };
    } catch (error) {
      console.error('Cache getStale error:', error);
      return null;
    }
  }

  /**
   * Clean up expired cache entries (run periodically)
   */
  async cleanupExpired(): Promise<number> {
    try {
      const { data, error } = await this.supabase
        .from('market_cache')
        .delete()
        .lt('expires_at', new Date().toISOString())
        .select();

      if (error) {
        console.error('Cache cleanup error:', error);
        return 0;
      }

      return data?.length || 0;
    } catch (error) {
      console.error('Cache cleanup error:', error);
      return 0;
    }
  }
}

/**
 * Cache duration constants (in seconds)
 */
export const CacheDuration = {
  QUOTE: 300,        // 5 minutes
  CHART: 600,        // 10 minutes
  METADATA: 43200,   // 12 hours
  TRENDING: 300,     // 5 minutes
};
