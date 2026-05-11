import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant =
  | "default"
  | "secondary"
  | "success"
  | "warning"
  | "destructive"
  | "info"
  | "outline";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const VARIANTS: Record<BadgeVariant, string> = {
  default: "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20",
  secondary: "bg-secondary text-secondary-foreground ring-1 ring-inset ring-border",
  success:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-1 ring-inset ring-emerald-500/30",
  warning:
    "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-1 ring-inset ring-amber-500/30",
  destructive:
    "bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-1 ring-inset ring-rose-500/30",
  info:
    "bg-sky-500/10 text-sky-700 dark:text-sky-400 ring-1 ring-inset ring-sky-500/30",
  outline: "ring-1 ring-inset ring-border text-foreground",
};

export function Badge({ variant = "default", className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight whitespace-nowrap",
        VARIANTS[variant],
        className
      )}
      {...rest}
    />
  );
}
