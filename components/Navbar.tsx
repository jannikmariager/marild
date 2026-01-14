'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { useDashboardTransition } from '@/components/DashboardTransitionProvider'
import { usePathname, useRouter } from 'next/navigation'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LogOut, LayoutDashboard, ChevronDown } from 'lucide-react'

export function Navbar() {
  const [user, setUser] = useState<User | null>(null)
  const [menuReady, setMenuReady] = useState(false)
  const supabaseEnabled = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const supabase = supabaseEnabled ? createSupabaseBrowserClient() : null
  const { startDashboardTransition } = useDashboardTransition()
  const router = useRouter()
  const pathname = usePathname()
  const webappUrl = process.env.NEXT_PUBLIC_WEBAPP_URL || 'http://localhost:3000'

  useEffect(() => {
    if (!supabase) {
      queueMicrotask(() => setMenuReady(true))
      return
    }

    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
    }

    getUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMenuReady(true)

    return () => subscription.unsubscribe()
  }, [supabase])

  const handleSignOut = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  const handleDashboardClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    startDashboardTransition()
    window.location.href = `${webappUrl}/dashboard`
  }

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-white/10 bg-[rgba(2,6,23,0.92)] backdrop-blur supports-[backdrop-filter]:bg-[rgba(2,6,23,0.85)]">
      <div className="container flex h-16 items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center space-x-3">
          <Image
            src="/marild-logo.svg"
            alt="Marild"
            width={132}
            height={32}
            priority
            className="h-8 w-auto"
          />
        </Link>

        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-6">
            <Link href="/" className="text-sm font-medium text-zinc-200 transition-colors hover:text-white">
              Home
            </Link>
            <Link href="/pricing" className="text-sm font-medium text-zinc-200 transition-colors hover:text-white">
              Pricing
            </Link>
            <Link href="/faq" className="text-sm font-medium text-zinc-200 transition-colors hover:text-white">
              FAQ
            </Link>
            <Link
              href="/dashboard"
              onClick={handleDashboardClick}
              className="text-sm font-medium text-zinc-200 transition-colors hover:text-white"
            >
              Dashboard
            </Link>
            {menuReady && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="text-sm font-medium h-auto p-0 hover:bg-transparent text-zinc-200">
                    Legal
                    <ChevronDown className="ml-1 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href="/terms" className="cursor-pointer">
                      Terms of Service
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/privacy" className="cursor-pointer">
                      Privacy Policy
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/data-policy" className="cursor-pointer">
                      Data Policy
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          
          <div className="flex items-center gap-4">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback>
                      {user.email?.charAt(0).toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end">
                <div className="flex items-center justify-start gap-2 p-2">
                  <div className="flex flex-col space-y-1 leading-none">
                    <p className="text-sm font-medium">{user.email}</p>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    window.location.href = `${webappUrl}/dashboard`
                  }}
                  className="cursor-pointer"
                >
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  Dashboard
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer">
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link href="/login">Login</Link>
              </Button>
              <Button asChild>
                <Link href="/signup">Sign Up</Link>
              </Button>
            </>
          )}
          </div>
        </div>
      </div>
    </nav>
  )
}
