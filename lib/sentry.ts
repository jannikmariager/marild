import { createClient } from './supabase/server';

export interface SentryIssue {
  id: string;
  title: string;
  level: 'error' | 'warning' | 'info' | 'fatal';
  culprit: string;
  count: number;
  userCount: number;
  firstSeen: Date;
  lastSeen: Date;
  status: 'unresolved' | 'resolved' | 'ignored';
  permalink: string;
}

export interface SentryStats {
  totalErrors: number;
  unresolvedErrors: number;
  affectedUsers: number;
  errorRate: number;
}

/**
 * Fetch Sentry issues using Sentry API
 */
export async function getSentryIssues(limit: number = 50): Promise<SentryIssue[]> {
  try {
    const sentryToken = process.env.SENTRY_AUTH_TOKEN;
    const sentryOrg = process.env.SENTRY_ORG;
    const sentryProject = process.env.SENTRY_PROJECT;

    if (!sentryToken || !sentryOrg || !sentryProject) {
      console.error('Sentry configuration missing');
      return [];
    }

    const response = await fetch(
      `https://sentry.io/api/0/projects/${sentryOrg}/${sentryProject}/issues/?statsPeriod=14d&limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${sentryToken}`,
        },
      }
    );

    if (!response.ok) {
      console.error('Failed to fetch Sentry issues:', response.statusText);
      return [];
    }

    const data = await response.json();

    return data.map((issue: any) => ({
      id: issue.id,
      title: issue.title || issue.culprit,
      level: issue.level || 'error',
      culprit: issue.culprit || 'Unknown',
      count: issue.count || 0,
      userCount: issue.userCount || 0,
      firstSeen: new Date(issue.firstSeen),
      lastSeen: new Date(issue.lastSeen),
      status: issue.status || 'unresolved',
      permalink: issue.permalink,
    }));
  } catch (error) {
    console.error('Error fetching Sentry issues:', error);
    return [];
  }
}

/**
 * Get Sentry stats overview
 */
export async function getSentryStats(): Promise<SentryStats> {
  try {
    const sentryToken = process.env.SENTRY_AUTH_TOKEN;
    const sentryOrg = process.env.SENTRY_ORG;
    const sentryProject = process.env.SENTRY_PROJECT;

    if (!sentryToken || !sentryOrg || !sentryProject) {
      console.error('Sentry configuration missing');
      return {
        totalErrors: 0,
        unresolvedErrors: 0,
        affectedUsers: 0,
        errorRate: 0,
      };
    }

    // Fetch project stats
    const response = await fetch(
      `https://sentry.io/api/0/projects/${sentryOrg}/${sentryProject}/stats/?stat=received&resolution=1d&since=${Math.floor(Date.now() / 1000) - 86400 * 7}`,
      {
        headers: {
          Authorization: `Bearer ${sentryToken}`,
        },
      }
    );

    if (!response.ok) {
      console.error('Failed to fetch Sentry stats:', response.statusText);
      return {
        totalErrors: 0,
        unresolvedErrors: 0,
        affectedUsers: 0,
        errorRate: 0,
      };
    }

    const statsData = await response.json();

    // Fetch issues for counts
    const issues = await getSentryIssues(100);
    const unresolvedIssues = issues.filter(i => i.status === 'unresolved');

    const totalErrors = statsData.reduce((sum: number, day: any) => sum + day[1], 0);
    const affectedUsers = new Set(issues.flatMap(i => i.userCount)).size;

    return {
      totalErrors,
      unresolvedErrors: unresolvedIssues.length,
      affectedUsers,
      errorRate: Math.round((totalErrors / 7) * 100) / 100, // Daily average
    };
  } catch (error) {
    console.error('Error fetching Sentry stats:', error);
    return {
      totalErrors: 0,
      unresolvedErrors: 0,
      affectedUsers: 0,
      errorRate: 0,
    };
  }
}

/**
 * Sync Sentry issues to system_alerts table
 */
export async function syncSentryToAlerts(): Promise<number> {
  try {
    const supabase = await createClient();
    const issues = await getSentryIssues(50);

    let synced = 0;

    for (const issue of issues) {
      if (issue.status === 'unresolved') {
        // Check if alert already exists
        const { data: existing } = await supabase
          .from('system_alerts')
          .select('id')
          .eq('alert_type', 'sentry_error')
          .eq('message', issue.title)
          .single();

        if (!existing) {
          // Create new alert
          const { error } = await supabase
            .from('system_alerts')
            .insert({
              alert_type: 'sentry_error',
              severity: issue.level === 'fatal' ? 'critical' : issue.level === 'error' ? 'high' : 'medium',
              message: issue.title,
              details: {
                sentry_id: issue.id,
                culprit: issue.culprit,
                count: issue.count,
                user_count: issue.userCount,
                permalink: issue.permalink,
                first_seen: issue.firstSeen,
                last_seen: issue.lastSeen,
              },
              is_resolved: false,
            });

          if (!error) synced++;
        }
      }
    }

    return synced;
  } catch (error) {
    console.error('Error syncing Sentry to alerts:', error);
    return 0;
  }
}

/**
 * Resolve a Sentry issue
 */
export async function resolveSentryIssue(issueId: string): Promise<boolean> {
  try {
    const sentryToken = process.env.SENTRY_AUTH_TOKEN;
    const sentryOrg = process.env.SENTRY_ORG;
    const sentryProject = process.env.SENTRY_PROJECT;

    if (!sentryToken || !sentryOrg || !sentryProject) {
      console.error('Sentry configuration missing');
      return false;
    }

    const response = await fetch(
      `https://sentry.io/api/0/projects/${sentryOrg}/${sentryProject}/issues/`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${sentryToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'resolved',
        }),
      }
    );

    return response.ok;
  } catch (error) {
    console.error('Error resolving Sentry issue:', error);
    return false;
  }
}

/**
 * Get error trends for charting (last 30 days)
 */
export async function getErrorTrends(): Promise<Array<{ date: string; errors: number }>> {
  try {
    const sentryToken = process.env.SENTRY_AUTH_TOKEN;
    const sentryOrg = process.env.SENTRY_ORG;
    const sentryProject = process.env.SENTRY_PROJECT;

    if (!sentryToken || !sentryOrg || !sentryProject) {
      console.error('Sentry configuration missing');
      return [];
    }

    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 86400 * 30;

    const response = await fetch(
      `https://sentry.io/api/0/projects/${sentryOrg}/${sentryProject}/stats/?stat=received&resolution=1d&since=${thirtyDaysAgo}`,
      {
        headers: {
          Authorization: `Bearer ${sentryToken}`,
        },
      }
    );

    if (!response.ok) {
      console.error('Failed to fetch error trends:', response.statusText);
      return [];
    }

    const data = await response.json();

    return data.map((day: any) => ({
      date: new Date(day[0] * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      errors: day[1],
    }));
  } catch (error) {
    console.error('Error fetching error trends:', error);
    return [];
  }
}
