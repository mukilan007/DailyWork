import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/Card";

/** Animated pulsing block. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      aria-hidden
    />
  );
}

/** Stat-card grid placeholder, mirrors the 4-up StatCard layout on Home. */
export function SkeletonStatGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-4 rounded" />
            </div>
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-24" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Generic card placeholder with N rows. */
export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <Card>
      <CardContent className="p-6 space-y-3">
        <Skeleton className="h-5 w-1/3" />
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

/** List of card-shaped rows, matches the activity / workout / todo lists. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-5 flex items-center gap-4">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
