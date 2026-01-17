import { cn } from "@/lib/utils"

interface ScreenshotPlaceholderProps {
  className?: string
  label?: string
}

export function ScreenshotPlaceholder({ className, label }: ScreenshotPlaceholderProps) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center rounded-3xl border border-white/15 bg-gradient-to-br from-white/10 to-white/0 shadow-[0_25px_80px_rgba(2,6,23,0.55)] backdrop-blur",
        "before:pointer-events-none before:absolute before:inset-px before:rounded-[22px] before:bg-gradient-to-br before:from-white/8 before:to-white/0",
        className
      )}
    >
      <span className="relative z-10 text-xs font-medium text-white/70">
        {label ?? "Preview coming soon"}
      </span>
    </div>
  )
}
