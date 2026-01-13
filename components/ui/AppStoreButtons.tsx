import { Apple, Play } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"

interface AppStoreButtonsProps {
  className?: string
}

export function AppStoreButtons({ className }: AppStoreButtonsProps) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center", className)}>
      <Link
        href="#"
        className="flex items-center gap-3 rounded-full bg-white px-5 py-3 text-left shadow-sm ring-1 ring-slate-200 transition hover:shadow-md"
      >
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-white">
          <Apple className="h-5 w-5" />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-xs text-slate-500">Download on the</span>
          <span className="text-sm font-semibold text-slate-900">App Store</span>
        </span>
      </Link>
      <Link
        href="#"
        className="flex items-center gap-3 rounded-full bg-white px-5 py-3 text-left shadow-sm ring-1 ring-slate-200 transition hover:shadow-md"
      >
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-white">
          <Play className="h-5 w-5" />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-xs text-slate-500">Get it on</span>
          <span className="text-sm font-semibold text-slate-900">Google Play</span>
        </span>
      </Link>
    </div>
  )
}
