import Link from 'next/link'

export function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="border-t border-border/40 bg-background">
      <div className="container py-8 md:py-12">
        <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
          <div className="text-center text-sm text-muted-foreground md:text-left">
<p>&copy; {currentYear} Marild. All rights reserved.</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-muted-foreground">
            <Link href="/privacy" className="transition-colors hover:text-foreground">
              Privacy Policy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
            <Link href="/eula" className="transition-colors hover:text-foreground">
              EULA
            </Link>
            <Link href="/data-policy" className="transition-colors hover:text-foreground">
              Data Policy
            </Link>
            <a
              href="mailto:support@marild.com"
              className="transition-colors hover:text-foreground"
            >
              Contact
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
