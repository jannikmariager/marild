"use client";

import { cn } from "@/lib/utils";

interface V4BadgeProps {
  version: string;
  className?: string;
}

export function V4Badge({ version, className }: V4BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600 border border-indigo-200",
        className,
      )}
    >
      Backtest V{version}
    </span>
  );
}
