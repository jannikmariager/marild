import { createClient } from './supabase/server';

export interface CrashLog {
  id: string;
  platform: 'ios' | 'android';
  appVersion: string;
  osVersion: string;
  message: string;
  stackTrace: string;
  userId?: string;
  deviceModel: string;
  timestamp: Date;
  isResolved: boolean;
}

export interface CrashStats {
  totalCrashes: number;
  iosCrashes: number;
  androidCrashes: number;
  affectedUsers: number;
  crashFreeRate: number;
}

export interface CrashTrend {
  date: string;
  ios: number;
  android: number;
}

/**
 * Get crash logs from database
 */
export async function getCrashLogs(limit: number = 50, platform?: 'ios' | 'android'): Promise<CrashLog[]> {
  try {
    const supabase = await createClient();
    
    let query = supabase
      .from('crashlogs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (platform) {
      query = query.eq('platform', platform);
    }

    const { data, error } = await query;

    if (error) throw error;

    return (data || []).map((log) => ({
      id: log.id,
      platform: log.platform,
      appVersion: log.app_version,
      osVersion: log.os_version,
      message: log.message,
      stackTrace: log.stack_trace,
      userId: log.user_id,
      deviceModel: log.device_model,
      timestamp: new Date(log.timestamp),
      isResolved: log.is_resolved || false,
    }));
  } catch (error) {
    console.error('Error fetching crash logs:', error);
    return [];
  }
}

/**
 * Get crash statistics
 */
export async function getCrashStats(): Promise<CrashStats> {
  try {
    const supabase = await createClient();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Get total crashes in last 7 days
    const { data: crashes } = await supabase
      .from('crashlogs')
      .select('platform, user_id')
      .gte('timestamp', sevenDaysAgo.toISOString());

    const totalCrashes = crashes?.length || 0;
    const iosCrashes = crashes?.filter(c => c.platform === 'ios').length || 0;
    const androidCrashes = crashes?.filter(c => c.platform === 'android').length || 0;
    const affectedUsers = new Set(crashes?.map(c => c.user_id).filter(Boolean)).size;

    // Get total sessions (assuming we track this)
    const { count: totalSessions } = await supabase
      .from('crashlogs')
      .select('id', { count: 'exact', head: true });

    const crashFreeRate = totalSessions && totalSessions > 0
      ? Math.round(((totalSessions - totalCrashes) / totalSessions) * 100 * 100) / 100
      : 100;

    return {
      totalCrashes,
      iosCrashes,
      androidCrashes,
      affectedUsers,
      crashFreeRate,
    };
  } catch (error) {
    console.error('Error fetching crash stats:', error);
    return {
      totalCrashes: 0,
      iosCrashes: 0,
      androidCrashes: 0,
      affectedUsers: 0,
      crashFreeRate: 100,
    };
  }
}

/**
 * Get crash trends for charting (last 30 days)
 */
export async function getCrashTrends(): Promise<CrashTrend[]> {
  try {
    const supabase = await createClient();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data } = await supabase
      .from('crashlogs')
      .select('platform, timestamp')
      .gte('timestamp', thirtyDaysAgo.toISOString())
      .order('timestamp', { ascending: true });

    if (!data) return [];

    // Group by day
    const groupedByDay = new Map<string, { ios: number; android: number }>();

    data.forEach((crash) => {
      const date = new Date(crash.timestamp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });

      const existing = groupedByDay.get(date) || { ios: 0, android: 0 };
      if (crash.platform === 'ios') {
        existing.ios++;
      } else if (crash.platform === 'android') {
        existing.android++;
      }
      groupedByDay.set(date, existing);
    });

    return Array.from(groupedByDay.entries()).map(([date, counts]) => ({
      date,
      ios: counts.ios,
      android: counts.android,
    }));
  } catch (error) {
    console.error('Error fetching crash trends:', error);
    return [];
  }
}

/**
 * Get most common crash causes
 */
export async function getTopCrashCauses(limit: number = 10): Promise<Array<{
  message: string;
  count: number;
  platform: string;
  latestVersion: string;
}>> {
  try {
    const supabase = await createClient();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data } = await supabase
      .from('crashlogs')
      .select('message, platform, app_version')
      .gte('timestamp', thirtyDaysAgo.toISOString());

    if (!data) return [];

    // Group by message
    const groupedByMessage = new Map<string, { count: number; platform: string; version: string }>();

    data.forEach((crash) => {
      const msg = crash.message || 'Unknown crash';
      const existing = groupedByMessage.get(msg) || { count: 0, platform: crash.platform, version: crash.app_version };
      existing.count++;
      groupedByMessage.set(msg, existing);
    });

    return Array.from(groupedByMessage.entries())
      .map(([message, data]) => ({
        message,
        count: data.count,
        platform: data.platform,
        latestVersion: data.version,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  } catch (error) {
    console.error('Error fetching top crash causes:', error);
    return [];
  }
}

/**
 * Mark crash as resolved
 */
export async function resolveCrash(crashId: string): Promise<boolean> {
  try {
    const supabase = await createClient();
    
    const { error } = await supabase
      .from('crashlogs')
      .update({ is_resolved: true })
      .eq('id', crashId);

    return !error;
  } catch (error) {
    console.error('Error resolving crash:', error);
    return false;
  }
}

/**
 * Get crashes by version
 */
export async function getCrashesByVersion(): Promise<Array<{
  version: string;
  crashes: number;
  platform: string;
}>> {
  try {
    const supabase = await createClient();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data } = await supabase
      .from('crashlogs')
      .select('app_version, platform')
      .gte('timestamp', thirtyDaysAgo.toISOString());

    if (!data) return [];

    // Group by version and platform
    const groupedByVersion = new Map<string, number>();

    data.forEach((crash) => {
      const key = `${crash.app_version}-${crash.platform}`;
      groupedByVersion.set(key, (groupedByVersion.get(key) || 0) + 1);
    });

    return Array.from(groupedByVersion.entries())
      .map(([key, crashes]) => {
        const [version, platform] = key.split('-');
        return { version, crashes, platform };
      })
      .sort((a, b) => b.crashes - a.crashes);
  } catch (error) {
    console.error('Error fetching crashes by version:', error);
    return [];
  }
}

/**
 * Sync Firebase Crashlytics data to database
 * This would integrate with Firebase Admin SDK in production
 */
export async function syncFirebaseCrashlytics(): Promise<number> {
  try {
    // This is a placeholder for Firebase Crashlytics integration
    // In production, you would:
    // 1. Initialize Firebase Admin SDK
    // 2. Fetch crashes from Firebase Crashlytics API
    // 3. Insert new crashes into crashlogs table
    
    console.log('Firebase Crashlytics sync not yet implemented');
    return 0;
  } catch (error) {
    console.error('Error syncing Firebase Crashlytics:', error);
    return 0;
  }
}
