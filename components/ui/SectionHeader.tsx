import { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface SectionHeaderProps {
  eyebrow?: string
  title: string
  subtitle?: string
  align?: "left" | "center"
  action?: ReactNode
  className?: string
}

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  align = "left",
  action,
  className,
}: SectionHeaderProps) {
  const alignment = align === "center" ? "items-center text-center" : "items-start text-left"

  return (
    <div className={cn("flex flex-col gap-3", alignment, className)}>
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {eyebrow}
        </p>
      ) : null}
      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className={cn("space-y-2", align === "center" ? "w-full" : "max-w-2xl") }>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            {title}
          </h2>
          {subtitle ? (
            <p className="text-sm text-slate-600 sm:text-base">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action ? <div className="mt-2 sm:mt-0">{action}</div> : null}
      </div>
    </div>
  )
}
