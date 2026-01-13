import { LoginForm } from '@/components/LoginForm'

export const dynamic = 'force-dynamic'

export default function LoginPage() {
  return (
    <div className="auth-page relative min-h-[calc(100vh-4rem)] flex items-center justify-center overflow-hidden px-4">
      <div className="auth-page-gradient" aria-hidden="true" />
      <div className="relative">
        <div
          className="pointer-events-none absolute -inset-32 rounded-full bg-emerald-500/15 blur-3xl opacity-60 auth-glow"
          aria-hidden="true"
        />
        <LoginForm />
      </div>
    </div>
  )
}
