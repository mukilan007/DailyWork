import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Render without the surrounding Card (when already inside one). */
  bare?: boolean;
}

/**
 * Empty state with icon tile, title, description, and optional CTA.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  bare,
}: EmptyStateProps) {
  const inner = (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-12",
        className
      )}
    >
      {icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );

  if (bare) return inner;
  return (
    <Card>
      <CardContent className="p-0">{inner}</CardContent>
    </Card>
  );
}
