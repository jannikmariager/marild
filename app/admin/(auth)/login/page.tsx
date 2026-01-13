'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { loginAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Shield } from 'lucide-react'
import { useFormStatus } from 'react-dom'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      className="w-full bg-emerald-600 hover:bg-emerald-700"
      disabled={pending}
    >
      {pending ? 'Signing in...' : 'Sign In'}
    </Button>
  )
}

const errorMessages: Record<string, string> = {
  unauthorized: 'You do not have permission to access the admin panel',
  missing_credentials: 'Email and password are required',
  authentication_failed: 'Authentication failed',
  unable_to_verify: 'Unable to verify admin privileges',
  not_admin: 'You do not have admin privileges',
}

function LoginForm() {
  const searchParams = useSearchParams()
  const errorParam = searchParams.get('error')
  const errorMessage = errorParam ? errorMessages[errorParam] || decodeURIComponent(errorParam) : null

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
            <CardTitle className="text-2xl font-bold">Admin Portal</CardTitle>
          </div>
          <CardDescription>
            Sign in to access the TradeLens AI admin dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          {errorMessage && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <form action={loginAction} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="admin@tradelens.ai"
                defaultValue="jannikmariager@hotmail.com"
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                required
              />
            </div>

            <SubmitButton />
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-foreground">Loading...</div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
