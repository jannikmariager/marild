import { MessageCircle, Send, Twitter, Instagram } from 'lucide-react'

export function SocialStrip() {
  const socials = [
    {
      name: 'Discord',
      icon: MessageCircle,
      url: process.env.NEXT_PUBLIC_DISCORD_URL || '#',
    },
    {
      name: 'Telegram',
      icon: Send,
      url: process.env.NEXT_PUBLIC_TELEGRAM_URL || '#',
    },
    {
      name: 'X',
      icon: Twitter,
      url: process.env.NEXT_PUBLIC_X_URL || '#',
    },
    {
      name: 'Instagram',
      icon: Instagram,
      url: process.env.NEXT_PUBLIC_INSTAGRAM_URL || '#',
    },
  ]

  return (
    <section className="border-y border-border/40 bg-muted/30">
      <div className="container py-8">
        <div className="flex flex-col items-center gap-6">
          <p className="text-sm font-medium text-muted-foreground">Join our community</p>
          <div className="flex flex-wrap items-center justify-center gap-6">
            {socials.map((social) => {
              const Icon = social.icon
              return (
                <a
                  key={social.name}
                  href={social.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary"
                >
                  <Icon className="h-5 w-5" />
                  <span>{social.name}</span>
                </a>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
