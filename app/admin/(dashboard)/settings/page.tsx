import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Settings as SettingsIcon, Shield, Bell, Database, Key } from 'lucide-react'
import { KPITile } from '@/components/admin/kpi-tile'

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure system and admin settings</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPITile title="System Status" value="Healthy" icon={SettingsIcon} />
        <KPITile title="Uptime" value="99.9%" icon={Database} />
        <KPITile title="API Keys" value="Active" icon={Key} />
        <KPITile title="Alerts" value="Enabled" icon={Bell} />
      </div>

      {/* Admin Users */}
      <Card>
        <CardHeader>
          <CardTitle>Admin Users</CardTitle>
          <CardDescription>Manage admin access and permissions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <Shield className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-foreground font-medium">jannikmariager@hotmail.com</p>
                  <p className="text-sm text-muted-foreground">Super Admin</p>
                </div>
              </div>
              <Button variant="outline">
                Manage
              </Button>
            </div>
          </div>

          <Button className="w-full mt-4 bg-emerald-600 hover:bg-emerald-700">
            Add Admin User
          </Button>
        </CardContent>
      </Card>

      {/* API Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>API Keys</CardTitle>
          <CardDescription>Manage external service API keys</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              { name: 'Supabase Service Key', status: 'Active', masked: '••••••••••••1234' },
              { name: 'Stripe Secret Key', status: 'Active', masked: '••••••••••••5678' },
              { name: 'OpenAI API Key', status: 'Active', masked: '••••••••••••9012' },
            ].map((api, i) => (
              <div key={i} className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div>
                  <p className="text-foreground font-medium">{api.name}</p>
                  <p className="text-sm text-muted-foreground font-mono">{api.masked}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-emerald-700 dark:text-emerald-300 text-sm">{api.status}</span>
                  <Button variant="ghost" size="sm" className="text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200">
                    Update
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* System Health */}
      <Card>
        <CardHeader>
          <CardTitle>System Health</CardTitle>
          <CardDescription>Overall system status and checks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { service: 'Supabase Database', status: 'Operational', color: 'text-emerald-700 dark:text-emerald-300' },
              { service: 'Edge Functions', status: 'Operational', color: 'text-emerald-700 dark:text-emerald-300' },
              { service: 'OpenAI API', status: 'Operational', color: 'text-emerald-700 dark:text-emerald-300' },
              { service: 'Stripe Integration', status: 'Operational', color: 'text-emerald-700 dark:text-emerald-300' },
            ].map((check, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-foreground">{check.service}</span>
                <span className={`font-medium ${check.color}`}>{check.status}</span>
              </div>
            ))}
          </div>

          <Button className="w-full mt-6" variant="outline">
            Run Health Check
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
