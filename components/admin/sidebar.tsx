'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Users,
  CreditCard,
  DollarSign,
  Cpu,
  Database,
  TrendingUp,
  MessageSquare,
  AlertTriangle,
  Bug,
  Send,
  FileText,
  Settings,
  BarChart3,
  Shield,
  Mail,
} from 'lucide-react'

const navigation = [
  { name: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { name: 'Users', href: '/admin/users', icon: Users },
  { name: 'Subscriptions', href: '/admin/subscriptions', icon: CreditCard },
  { name: 'Revenue', href: '/admin/revenue', icon: DollarSign },
  { name: 'AI Tokens', href: '/admin/ai-tokens', icon: Cpu },
  { name: 'Data Costs', href: '/admin/data-costs', icon: Database },
  { name: 'Engine Metrics', href: '/admin/engine-metrics', icon: Cpu },
  { name: '  └ SWING_V2_ROBUST', href: '/admin/engine-metrics/swing-v2-robust', icon: Cpu },
  { name: '  └ SCALP_V1_MICROEDGE', href: '/admin/engine-metrics/scalp-v1-microedge', icon: Cpu },
  { name: '  └ SWING_V1_12_15DEC', href: '/admin/engine-metrics/swing-v1-12-15dec', icon: Cpu },
  { name: '  └ SWING_FAV8_SHADOW', href: '/admin/engine-metrics/swing-fav8-shadow', icon: Cpu },
  { name: '  └ Crypto V1', href: '/admin/engine-metrics/crypto-v1-shadow', icon: Cpu },
  { name: 'Engine Performance', href: '/admin/engines', icon: TrendingUp },
  { name: 'Engine Allocation', href: '/admin/engine-allocation', icon: Shield },
  { name: 'SMC Engine', href: '/admin/smc-engine', icon: TrendingUp },
  { name: 'Signals', href: '/admin/signals', icon: BarChart3 },
  { name: '  └ Debug', href: '/admin/signals/debug', icon: Bug },
  { name: 'Early Access', href: '/admin/early-access', icon: Users },
  { name: 'Contact Requests', href: '/admin/contact-requests', icon: Mail },
  { name: 'Discord', href: '/admin/discord', icon: MessageSquare },
  { name: 'Crashes', href: '/admin/crashes', icon: Bug },
  { name: 'Errors', href: '/admin/errors', icon: AlertTriangle },
  { name: 'Push', href: '/admin/push', icon: Send },
  { name: 'Content', href: '/admin/content', icon: FileText },
  { name: 'Settings', href: '/admin/settings', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-6">
        <Shield className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
        <div>
          <h1 className="text-lg font-bold">TradeLens AI</h1>
          <p className="text-xs text-muted-foreground">Admin Portal</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
