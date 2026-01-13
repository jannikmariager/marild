import { Apple, Play } from 'lucide-react'

export function AppStoreButtons() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <a
        href="#"
        className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
      >
        <Apple className="h-6 w-6" />
        <div className="flex flex-col items-start">
          <span className="text-[10px] leading-none">Download on the</span>
          <span className="text-sm font-semibold leading-none">App Store</span>
        </div>
      </a>
      <a
        href="#"
        className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
      >
        <Play className="h-6 w-6" />
        <div className="flex flex-col items-start">
          <span className="text-[10px] leading-none">GET IT ON</span>
          <span className="text-sm font-semibold leading-none">Google Play</span>
        </div>
      </a>
    </div>
  )
}
