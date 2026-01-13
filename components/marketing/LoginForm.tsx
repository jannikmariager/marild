'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Link from 'next/link'
import { useDashboardTransition } from '@/components/DashboardTransitionProvider'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const router = useRouter()
  const { startDashboardTransition } = useDashboardTransition()
  const supabaseEnabled = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const supabase = supabaseEnabled ? createSupabaseBrowserClient() : null

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    if (!supabase) {
      setLoading(false)
      setMessage({ type: 'error', text: 'Login is temporarily unavailable. Please try again later.' })
      return
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    })

    setLoading(false)

    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      setMessage({ type: 'success', text: 'Check your email for the login link!' })
    }
  }

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    if (!supabase) {
      setLoading(false)
      setMessage({ type: 'error', text: 'Login is temporarily unavailable. Please try again later.' })
      return
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      startDashboardTransition()
      router.push('/dashboard')
    }
  }

  const handleGoogleAuth = async () => {
    try {
      setLoading(true)
      setMessage(null)
      if (!supabase) throw new Error('Login unavailable')
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${process.env.NEXT_PUBLIC_WEBAPP_URL || window.location.origin}/dashboard`,
        },
      })
      if (error) {
        setMessage({ type: 'error', text: error.message })
      }
      // Supabase will redirect on success; no need to push here.
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to continue with Google'
      setMessage({ type: 'error', text: msg })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Enter the Live Trading Dashboard
        </CardTitle>
        <CardDescription className="text-sm sm:text-base">
          View live portfolios, real trades, and full performance transparency. One plan. Full access. Cancel anytime.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="w-full justify-center"
            onClick={handleGoogleAuth}
            disabled={loading}
          >
            Continue with Google
          </Button>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            <span>or</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        </div>

        <Tabs defaultValue="password" className="w-full mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="password">Password</TabsTrigger>
            <TabsTrigger value="magic-link">Magic Link</TabsTrigger>
          </TabsList>
          
          <TabsContent value="password">
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <div className="space-y-2">
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {message && (
                <p className={`text-sm ${message.type === 'error' ? 'text-destructive' : 'text-green-500'}`}>
                  {message.text}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign in'}
              </Button>
              <p className="mt-2 text-[0.7rem] text-muted-foreground text-center">
                Takes less than 10 seconds · No setup required
              </p>
            </form>
          </TabsContent>
          
          <TabsContent value="magic-link">
            <form onSubmit={handleMagicLink} className="space-y-4">
              <div className="space-y-2">
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              {message && (
                <p className={`text-sm ${message.type === 'error' ? 'text-destructive' : 'text-green-500'}`}>
                  {message.text}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending...' : 'Send magic link'}
              </Button>
              <p className="mt-2 text-[0.7rem] text-muted-foreground text-center">
                Next: Check your inbox · Tap the secure login link
              </p>
            </form>
          </TabsContent>
        </Tabs>

        <div className="mt-6 text-center text-sm">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Sign up
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
