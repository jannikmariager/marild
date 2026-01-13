import Link from "next/link"
import { MessageCircle, Send, Twitter, Instagram } from "lucide-react"

const footerSocials = [
  { name: "Discord", href: "#", icon: MessageCircle },
  { name: "Telegram", href: "#", icon: Send },
  { name: "X", href: "#", icon: Twitter },
  { name: "Instagram", href: "#", icon: Instagram },
]

export function LandingFooter() {
  return (
    <footer className="border-t border-white/10 bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="text-base font-semibold tracking-tight text-foreground">
Marild
            </div>
            <p className="text-xs text-muted-foreground">
              Structured AI market intelligence for modern traders.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <Link href="#pricing" className="hover:text-foreground transition-colors">
              Pricing
            </Link>
            <Link href="/dashboard" className="hover:text-foreground transition-colors">
              Dashboard
            </Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">
              Privacy
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {footerSocials.map((social) => {
              const Icon = social.icon
              return (
                <a
                  key={social.name}
                  href={social.href}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors"
                >
                  <Icon className="h-4 w-4" />
                </a>
              )
            })}
          </div>
        </div>

        <div className="mt-6 border-t border-white/10 pt-4 text-xs text-muted-foreground">
          <p>
&copy; {new Date().getFullYear()} Marild. All rights reserved. Nothing on this site constitutes financial advice.
          </p>
        </div>
      </div>
    </footer>
  )
}
