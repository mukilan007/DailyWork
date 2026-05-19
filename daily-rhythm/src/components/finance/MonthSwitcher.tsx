import { ChevronLeft, ChevronRight } from "lucide-react";
import { MONTH_LABEL } from "@/lib/finance";
import { cn } from "@/lib/utils";

interface MonthSwitcherProps {
  year: number;
  /** 0-based month index (0 = Jan). */
  month: number;
  onChange: (year: number, month: number) => void;
  /** When true, render year only (used by the Monthly year view). */
  yearOnly?: boolean;
  className?: string;
}

/**
 * Header used across the Finance pages: `<  Feb 2026  >` with prev/next arrows.
 * Matches the screenshots' top control.
 */
export function MonthSwitcher({
  year,
  month,
  onChange,
  yearOnly = false,
  className,
}: MonthSwitcherProps) {
  function go(delta: number) {
    if (yearOnly) {
      onChange(year + delta, month);
      return;
    }
    const next = new Date(year, month + delta, 1);
    onChange(next.getFullYear(), next.getMonth());
  }
  return (
    <div className={cn("flex items-center justify-between", className)}>
      <button
        type="button"
        aria-label="Previous"
        onClick={() => go(-1)}
        className="rounded-md p-2 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <div className="text-base font-medium">
        {yearOnly ? year : `${MONTH_LABEL[month]} ${year}`}
      </div>
      <button
        type="button"
        aria-label="Next"
        onClick={() => go(1)}
        className="rounded-md p-2 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}
