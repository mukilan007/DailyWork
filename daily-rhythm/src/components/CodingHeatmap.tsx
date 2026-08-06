import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { addDays, startOfWeek, ymd, parseYmd } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { CodingProblemRow } from "@/types";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// GitHub-style 5-step colour ramp. Emerald reads on both light and dark.
const LEVEL_CLASS = [
  "bg-foreground/10",
  "bg-emerald-500/30",
  "bg-emerald-500/55",
  "bg-emerald-500/80",
  "bg-emerald-500",
];

function level(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}

/**
 * A year-long contribution heatmap of solved coding problems, keyed on
 * `solved_on`. Weeks are columns (Mon–Sun rows), coloured by solves-per-day,
 * with a year switcher — mirrors the GitHub contribution graph.
 */
export function CodingHeatmap({ problems }: { problems: CodingProblemRow[] }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  // date (YYYY-MM-DD) -> number solved that day
  const countByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of problems) {
      if (!p.solved_on) continue;
      m.set(p.solved_on, (m.get(p.solved_on) ?? 0) + 1);
    }
    return m;
  }, [problems]);

  const { weeks, total } = useMemo(() => {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);
    const gridStart = startOfWeek(yearStart); // Monday on/before Jan 1
    const cols: Date[][] = [];
    let cursor = gridStart;
    while (cursor <= yearEnd) {
      cols.push(Array.from({ length: 7 }, (_, d) => addDays(cursor, d)));
      cursor = addDays(cursor, 7);
    }
    let sum = 0;
    for (const [day, n] of countByDay) {
      if (parseYmd(day).getFullYear() === year) sum += n;
    }
    return { weeks: cols, total: sum };
  }, [year, countByDay]);

  const todayYmd = ymd();

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">
            <span className="tabular-nums">{total}</span> problem
            {total === 1 ? "" : "s"} solved in {year}
          </h3>
          <div className="inline-flex items-center gap-1 rounded-md border bg-card p-0.5">
            <button
              type="button"
              onClick={() => setYear((y) => y - 1)}
              aria-label="Previous year"
              className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-1.5 text-sm font-medium tabular-nums">{year}</span>
            <button
              type="button"
              onClick={() => setYear((y) => Math.min(currentYear, y + 1))}
              disabled={year >= currentYear}
              aria-label="Next year"
              className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="inline-block min-w-max">
            {/* Month labels aligned to week columns */}
            <div className="flex gap-[3px] pl-8 mb-1">
              {weeks.map((week, i) => {
                const first = week[0];
                const prev = i > 0 ? weeks[i - 1][0] : null;
                const show =
                  first.getFullYear() === year &&
                  (!prev || first.getMonth() !== prev.getMonth());
                return (
                  <div
                    key={i}
                    className="w-[11px] text-[10px] text-muted-foreground"
                  >
                    {show ? MONTHS_SHORT[first.getMonth()] : ""}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-1">
              {/* Weekday labels — Mon / Wed / Fri like GitHub */}
              <div
                className="grid gap-[3px] text-[10px] text-muted-foreground pr-1"
                style={{ gridTemplateRows: "repeat(7, 11px)" }}
              >
                {["", "Mon", "", "Wed", "", "Fri", ""].map((d, i) => (
                  <span key={i} className="leading-[11px]">
                    {d}
                  </span>
                ))}
              </div>

              {/* Week columns */}
              <div
                className="grid grid-flow-col gap-[3px]"
                style={{ gridTemplateRows: "repeat(7, 11px)", gridAutoColumns: "11px" }}
              >
                {weeks.flatMap((week) =>
                  week.map((day) => {
                    const key = ymd(day);
                    const inYear = day.getFullYear() === year;
                    const future = key > todayYmd;
                    if (!inYear || future) {
                      return (
                        <span
                          key={key}
                          className="h-[11px] w-[11px] rounded-[2px] bg-transparent"
                        />
                      );
                    }
                    const count = countByDay.get(key) ?? 0;
                    return (
                      <span
                        key={key}
                        title={`${count} solved on ${parseYmd(key).toLocaleDateString([], {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}`}
                        className={cn(
                          "h-[11px] w-[11px] rounded-[2px]",
                          LEVEL_CLASS[level(count)],
                          key === todayYmd && "ring-1 ring-primary ring-offset-1 ring-offset-background"
                        )}
                      />
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
          <span>Less</span>
          {LEVEL_CLASS.map((c, i) => (
            <span key={i} className={cn("h-[11px] w-[11px] rounded-[2px]", c)} />
          ))}
          <span>More</span>
        </div>
      </CardContent>
    </Card>
  );
}
