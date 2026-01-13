import { createClient } from './supabase/server';

export interface DiscordStats {
  totalMembers: number;
  activeMembers: number;
  totalMessages: number;
  newMembersToday: number;
  messagesGrowth: number;
}

export interface DiscordGuildInfo {
  id: string;
  name: string;
  memberCount: number;
  onlineCount: number;
  iconUrl?: string;
}

export interface DiscordActivity {
  date: string;
  messages: number;
  activeUsers: number;
}

/**
 * Fetch guild info directly from Discord API
 */
export async function fetchDiscordGuildInfo(): Promise<DiscordGuildInfo | null> {
  try {
    const botToken = process.env.DISCORD_BOT_TOKEN;
    const guildId = process.env.DISCORD_GUILD_ID;

    if (!botToken || !guildId) {
      console.error('Discord credentials missing');
      return null;
    }

    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}?with_counts=true`, {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    });

    if (!response.ok) {
      console.error('Failed to fetch Discord guild:', response.statusText);
      return null;
    }

    const guild = await response.json();

    return {
      id: guild.id,
      name: guild.name,
      memberCount: guild.approximate_member_count || 0,
      onlineCount: guild.approximate_presence_count || 0,
      iconUrl: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : undefined,
    };
  } catch (error) {
    console.error('Error fetching Discord guild info:', error);
    return null;
  }
}

/**
 * Get Discord server stats (combines API data with database records)
 */
export async function getDiscordStats(): Promise<DiscordStats> {
  try {
    // Fetch real-time data from Discord API
    const guildInfo = await fetchDiscordGuildInfo();
    
    if (!guildInfo) {
      // Fallback to database if API fails
      return getDiscordStatsFromDB();
    }

    const supabase = await createClient();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    // Get yesterday's member count for growth calculation
    const { data: yesterdayData } = await supabase
      .from('discord_activity')
      .select('member_count')
      .gte('timestamp', yesterday.toISOString())
      .lt('timestamp', new Date(yesterday.getTime() + 86400000).toISOString())
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

    const newMembersToday = guildInfo.memberCount - (yesterdayData?.member_count || guildInfo.memberCount);

    return {
      totalMembers: guildInfo.memberCount,
      activeMembers: guildInfo.onlineCount,
      totalMessages: 0, // Would need message tracking
      newMembersToday,
      messagesGrowth: 0, // Would need message tracking
    };
  } catch (error) {
    console.error('Error fetching Discord stats:', error);
    return {
      totalMembers: 0,
      activeMembers: 0,
      totalMessages: 0,
      newMembersToday: 0,
      messagesGrowth: 0,
    };
  }
}

/**
 * Get Discord stats from database (fallback)
 */
async function getDiscordStatsFromDB(): Promise<DiscordStats> {
  try {
    const supabase = await createClient();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: todayData } = await supabase
      .from('discord_activity')
      .select('*')
      .gte('timestamp', today.toISOString())
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

    return {
      totalMembers: todayData?.member_count || 0,
      activeMembers: todayData?.active_member_count || 0,
      totalMessages: todayData?.message_count || 0,
      newMembersToday: 0,
      messagesGrowth: 0,
    };
  } catch (error) {
    console.error('Error fetching Discord stats from DB:', error);
    return {
      totalMembers: 0,
      activeMembers: 0,
      totalMessages: 0,
      newMembersToday: 0,
      messagesGrowth: 0,
    };
  }
}

/**
 * Get Discord activity chart data for the last 30 days
 */
export async function getDiscordActivityChart(): Promise<DiscordActivity[]> {
  try {
    const supabase = await createClient();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data } = await supabase
      .from('discord_activity')
      .select('*')
      .gte('timestamp', thirtyDaysAgo.toISOString())
      .order('timestamp', { ascending: true });

    if (!data) return [];

    // Group by day
    const groupedByDay = new Map<string, { messages: number; activeUsers: number }>();

    data.forEach((record) => {
      const date = new Date(record.timestamp).toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
      });
      
      const existing = groupedByDay.get(date) || { messages: 0, activeUsers: 0 };
      groupedByDay.set(date, {
        messages: existing.messages + (record.message_count || 0),
        activeUsers: Math.max(existing.activeUsers, record.active_member_count || 0),
      });
    });

    return Array.from(groupedByDay.entries()).map(([date, stats]) => ({
      date,
      messages: stats.messages,
      activeUsers: stats.activeUsers,
    }));
  } catch (error) {
    console.error('Error fetching Discord activity chart:', error);
    return [];
  }
}

/**
 * Get top Discord channels by activity
 */
export async function getTopDiscordChannels(): Promise<Array<{
  channel: string;
  messages: number;
  activeUsers: number;
}>> {
  try {
    const supabase = await createClient();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // This assumes we have channel-level data in discord_activity
    // If not, this will return empty array
    const { data } = await supabase
      .from('discord_activity')
      .select('channel_name, message_count, active_member_count')
      .gte('timestamp', sevenDaysAgo.toISOString())
      .order('message_count', { ascending: false })
      .limit(10);

    if (!data) return [];

    // Group by channel
    const channelMap = new Map<string, { messages: number; activeUsers: number }>();

    data.forEach((record) => {
      const channel = record.channel_name || 'General';
      const existing = channelMap.get(channel) || { messages: 0, activeUsers: 0 };
      channelMap.set(channel, {
        messages: existing.messages + (record.message_count || 0),
        activeUsers: Math.max(existing.activeUsers, record.active_member_count || 0),
      });
    });

    return Array.from(channelMap.entries())
      .map(([channel, stats]) => ({
        channel,
        messages: stats.messages,
        activeUsers: stats.activeUsers,
      }))
      .sort((a, b) => b.messages - a.messages)
      .slice(0, 10);
  } catch (error) {
    console.error('Error fetching top Discord channels:', error);
    return [];
  }
}

/**
 * Send a message to Discord via webhook
 */
export async function sendDiscordNotification(message: string, webhookUrl?: string): Promise<boolean> {
  try {
    const url = webhookUrl || process.env.DISCORD_WEBHOOK_URL;
    if (!url) {
      console.error('Discord webhook URL not configured');
      return false;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: message,
        username: 'TradeLens Admin',
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Error sending Discord notification:', error);
    return false;
  }
}
