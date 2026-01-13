import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MessageSquare, Users, TrendingUp, Activity, RefreshCw } from 'lucide-react'
import { KPITile } from '@/components/admin/kpi-tile'
import { getDiscordStats, fetchDiscordGuildInfo } from '@/lib/discord'
import { SyncDiscordButton } from './sync-button'
export const dynamic = 'force-dynamic'

async function getDiscordData() {
  const [stats, guildInfo] = await Promise.all([
    getDiscordStats(),
    fetchDiscordGuildInfo(),
  ]);

  return { stats, guildInfo };
}

export default async function DiscordPage() {
  const { stats, guildInfo } = await getDiscordData();
  const isConnected = !!guildInfo;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Discord Community</h1>
          <p className="text-muted-foreground mt-1">
            {isConnected ? `Connected to: ${guildInfo.name}` : 'Monitor community engagement and activity'}
          </p>
        </div>
        {isConnected && <SyncDiscordButton />}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPITile 
          title="Total Members" 
          value={stats.totalMembers.toLocaleString()} 
          icon={Users} 
          trend={stats.newMembersToday > 0 ? { value: stats.newMembersToday, label: 'today', isPositive: true } : undefined}
        />
        <KPITile 
          title="Active Now" 
          value={stats.activeMembers.toLocaleString()} 
          icon={Activity} 
        />
        <KPITile 
          title="Messages" 
          value={stats.totalMessages > 0 ? stats.totalMessages.toLocaleString() : 'N/A'} 
          icon={MessageSquare} 
        />
        <KPITile 
          title="Growth" 
          value={`+${stats.newMembersToday}`} 
          icon={TrendingUp} 
        />
      </div>

      {!isConnected && (
        <Card>
          <CardHeader>
            <CardTitle>Discord Integration</CardTitle>
            <CardDescription>Connect Discord bot to display real-time stats</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12">
              <MessageSquare className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Discord bot not connected</p>
              <p className="text-sm text-muted-foreground mt-2">Add DISCORD_BOT_TOKEN and DISCORD_GUILD_ID to environment variables</p>
            </div>
          </CardContent>
        </Card>
      )}

      {isConnected && guildInfo.iconUrl && (
        <Card>
          <CardHeader>
            <CardTitle>Server Info</CardTitle>
            <CardDescription>Discord server details</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <img 
                src={guildInfo.iconUrl} 
                alt={guildInfo.name}
                className="w-16 h-16 rounded-full"
              />
              <div>
                <h3 className="text-lg font-semibold text-foreground">{guildInfo.name}</h3>
                <p className="text-sm text-muted-foreground">Server ID: {guildInfo.id}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
