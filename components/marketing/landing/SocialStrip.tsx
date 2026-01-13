import { MessageCircle, Send, Twitter, Instagram } from "lucide-react"

const socials = [
  {
    name: "Discord",
    href: "#",
    icon: MessageCircle,
  },
  {
    name: "Telegram",
    href: "#",
    icon: Send,
  },
  {
    name: "X",
    href: "#",
    icon: Twitter,
  },
  {
    name: "Instagram",
    href: "#",
    icon: Instagram,
  },
]

export function SocialStrip() {
  return (
    <section className="border-y border-slate-200 bg-[#F2F4F7]">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-4 sm:flex-row sm:justify-between sm:px-6 lg:px-8">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Join our community
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {socials.map((social) => {
            const Icon = social.icon
            return (
              <a
                key={social.name}
                href={social.href}
                className="flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                  <Icon className="h-4 w-4" />
                </span>
                <span>{social.name}</span>
              </a>
            )
          })}
        </div>
      </div>
    </section>
  )
}
