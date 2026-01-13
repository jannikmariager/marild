'use server';

import { fetchDiscordGuildInfo } from '@/lib/discord';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * Sync Discord guild stats to the database
 */
export async function syncDiscordStats() {
  try {
    const guildInfo = await fetchDiscordGuildInfo();
    
    if (!guildInfo) {
      return { success: false, error: 'Failed to fetch Discord guild info' };
    }

    const supabase = await createAdminClient();
    
    // Insert current stats into discord_activity table
    const { error } = await supabase
      .from('discord_activity')
      .insert({
        timestamp: new Date().toISOString(),
        member_count: guildInfo.memberCount,
        active_member_count: guildInfo.onlineCount,
        message_count: 0, // Would need message tracking from bot
        channel_name: 'general', // Default channel
      });

    if (error) {
      console.error('Failed to insert Discord stats:', error);
      return { success: false, error: error.message };
    }

    return { 
      success: true, 
      data: {
        memberCount: guildInfo.memberCount,
        onlineCount: guildInfo.onlineCount,
      }
    };
  } catch (error) {
    console.error('Error syncing Discord stats:', error);
    return { success: false, error: String(error) };
  }
}
