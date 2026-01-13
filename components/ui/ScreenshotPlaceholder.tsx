import { cn } from "@/lib/utils"

interface ScreenshotPlaceholderProps {
  className?: string
  label?: string
}

export function ScreenshotPlaceholder({ className, label }: ScreenshotPlaceholderProps) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 shadow-sm",
        "before:pointer-events-none before:absolute before:inset-px before:rounded-[22px] before:bg-gradient-to-br before:from-white/60 before:to-slate-50",
        className
      )}
    >
      <span className="relative z-10 text-xs font-medium text-slate-400">
        {label ?? "Preview coming soon"}
      </span>
    </div>
  )
}
