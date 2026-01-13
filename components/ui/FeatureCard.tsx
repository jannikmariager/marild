import { ElementType } from "react"
import { cn } from "@/lib/utils"

interface FeatureCardProps {
  icon: ElementType
  title: string
  description: string
  className?: string
}

export function FeatureCard({ icon: Icon, title, description, className }: FeatureCardProps) {
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-2xl border border-[#EEF1F4] bg-white p-6 shadow-sm",
        className
      )}
    >
      <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#E6F7F2] text-[#0AAE84]">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mb-2 text-base font-semibold text-slate-900">
        {title}
      </h3>
      <p className="text-sm text-slate-600">
        {description}
      </p>
    </div>
  )
}
