'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

export function SignupForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [acceptedLegal, setAcceptedLegal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const router = useRouter()
  const supabaseEnabled = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const supabase = supabaseEnabled ? createSupabaseBrowserClient() : null

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    if (!supabase) {
      setLoading(false)
      setMessage({ type: 'error', text: 'Signups are temporarily unavailable. Please try again later or contact support.' })
      return
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    })

    setLoading(false)

    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      setMessage({ 
        type: 'success', 
        text: 'Success! Check your email to confirm your account.' 
      })
      setTimeout(() => router.push('/login'), 2000)
    }
  }

  const handleGoogleSignup = async () => {
    try {
      setLoading(true)
      setMessage(null)
      if (!supabase) throw new Error('Signups unavailable')
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
        },
      })
      if (error) {
        setMessage({ type: 'error', text: error.message })
      }
      // On success, Supabase redirects to /dashboard.
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to continue with Google'
      setMessage({ type: 'error', text: msg })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-lg border border-emerald-500/20 bg-gradient-to-b from-background/80 to-background shadow-xl shadow-emerald-500/15">
      <CardHeader className="space-y-2">
        <CardTitle className="text-2xl sm:text-3xl font-semibold tracking-tight">
          You’re One Step Away From Live Trading Insights
        </CardTitle>
        <CardDescription className="text-sm sm:text-base">
          View live portfolios, structured AI signals, and full performance transparency. One plan. Full access. Cancel anytime.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="w-full justify-center"
            onClick={handleGoogleSignup}
            disabled={loading}
          >
            Continue with Google
          </Button>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            <span>or sign up with email</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        </div>

        <form onSubmit={handleSignup} className="space-y-4 mt-4">
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
              placeholder="Password (min 6 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          <div className="space-y-1 text-[0.7rem] text-muted-foreground">
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5 h-3 w-3 rounded border border-border accent-emerald-500"
                checked={acceptedLegal}
                onChange={(e) => setAcceptedLegal(e.target.checked)}
                required
              />
              <span>
                I have read and understood the{' '}
                <Link href="/terms" className="underline hover:text-primary">Terms</Link>,{' '}
                <Link href="/privacy" className="underline hover:text-primary">Privacy Policy</Link>, and{' '}
                <Link href="/data-policy" className="underline hover:text-primary">Data Policy</Link>. I understand that Marild
                provides signal intelligence and educational tools only and does not provide personal investment,
                trading, or financial advice.
              </span>
            </label>
          </div>

          {message && (
            <p className={`text-sm ${message.type === 'error' ? 'text-destructive' : 'text-green-500'}`}>
              {message.text}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={loading || !acceptedLegal}>
            {loading ? 'Creating account...' : 'Sign up'}
          </Button>
          <p className="mt-2 text-[0.7rem] text-muted-foreground text-center">
            Next: Portfolio initialization → Live performance overview
          </p>
        </form>

        <div className="mt-6 text-center text-sm">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
