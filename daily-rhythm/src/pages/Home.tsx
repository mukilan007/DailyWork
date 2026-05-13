import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity as ActivityIcon,
  Dumbbell,
  Droplet,
  TrendingUp,
  ArrowRight,
  CalendarRange,
  CalendarHeart,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { SkeletonStatGrid, SkeletonCard } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase, isMissingColumnError } from "@/lib/supabase";
import type { Activity, ActivityCompletion, Workout, GlucoseReading, PeriodLog } from "@/types";
import { ymd, weekDates, DAY_LABELS, formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { computeCycleInsights } from "./HealthPeriod";

/** Available time windows for the dashboard's time-based data. Keeping the
 *  options in one table lets the selector, query window, and stat labels
 *  all read from the same source. */
const RANGE_OPTIONS = [
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "90 days", days: 90 },
  { id: "1y", label: "1 year", days: 365 },
] as const;
type RangeId = (typeof RANGE_OPTIONS)[number]["id"];

interface HomeData {
  activities: Activity[];
  completions: ActivityCompletion[];
  workouts: Workout[];
  glucose: GlucoseReading[];
  /** Recent period logs — fetched outside the range filter because cycle
   *  prediction needs at least two prior period starts regardless of the
   *  dashboard's selected window. */
  periodLogs: PeriodLog[];
  displayName: string | null;
}

export function HomePage() {
  const { user } = useAuth();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Selected time window for all time-based panels. Re-fetches data when
   *  changed so workouts/glucose/completions reflect the chosen range. */
  const [rangeId, setRangeId] = useState<RangeId>("7d");
  const range = useMemo(
    () => RANGE_OPTIONS.find((r) => r.id === rangeId) ?? RANGE_OPTIONS[0],
    [rangeId]
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const rangeStartYmd = ymdDaysAgo(range.days);
      const rangeStartIso = new Date(`${rangeStartYmd}T00:00:00`).toISOString();
      // Prefer the server-side `is_archived = false` filter so Postgres can
      // use the partial index; fall back to an unfiltered query if the
      // user's DB doesn't have the column yet.
      const [activitiesRes, completionsRes, workoutsRes, glucoseRes, periodRes, profileRes] = await Promise.all([
        supabase.from("activities").select("*").eq("is_archived", false),
        supabase.from("activity_completions").select("*").gte("completed_on", rangeStartYmd),
        supabase
          .from("workouts")
          .select("*")
          .gte("performed_at", rangeStartIso)
          .order("performed_at", { ascending: false })
          .limit(100),
        supabase
          .from("glucose_readings")
          .select("*")
          .gte("measured_at", rangeStartIso)
          .order("measured_at", { ascending: false })
          .limit(200),
        supabase
          .from("period_logs")
          .select("*")
          .order("log_date", { ascending: false })
          .limit(180),
        supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle(),
      ]);
      if (cancelled) return;

      let activitiesData = activitiesRes.data ?? [];
      let activitiesError = activitiesRes.error;
      if (isMissingColumnError(activitiesError, "is_archived")) {
        const retry = await supabase.from("activities").select("*");
        if (cancelled) return;
        activitiesData = (retry.data ?? []).filter((a) => !a.is_archived);
        activitiesError = retry.error;
      }

      const firstError =
        activitiesError ??
        completionsRes.error ??
        workoutsRes.error ??
        glucoseRes.error ??
        periodRes.error ??
        profileRes.error;
      if (firstError) {
        setError(firstError.message);
        return;
      }

      // Drop completions that belong to archived (or otherwise-missing)
      // activities so today's count and the weekly chart don't keep
      // crediting hidden habits.
      const activeIds = new Set(activitiesData.map((a) => a.id));
      const visibleCompletions = (completionsRes.data ?? []).filter((c) =>
        activeIds.has(c.activity_id)
      );

      setData({
        activities: activitiesData,
        completions: visibleCompletions,
        workouts: workoutsRes.data ?? [],
        glucose: glucoseRes.data ?? [],
        periodLogs: periodRes.data ?? [],
        displayName: profileRes.data?.display_name ?? null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, range.days]);

  const today = ymd();
  const greeting = useMemo(() => greetingFor(new Date()), []);
  const week = useMemo(() => weekDates(), []);
  const weekKeys = useMemo(() => week.map((d) => ymd(d)), [week]);

  if (error) {
    return (
      <div className="space-y-6">
        <Hero greeting={greeting} name="" />
        <RangeSelector value={rangeId} onChange={setRangeId} />
        <ErrorAlert message={error} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <Hero greeting={greeting} name="…" />
        <RangeSelector value={rangeId} onChange={setRangeId} />
        <SkeletonStatGrid />
        <div className="grid gap-4 lg:grid-cols-2">
          <SkeletonCard rows={4} />
          <SkeletonCard rows={4} />
        </div>
      </div>
    );
  }

  const todayDone = data.completions.filter((c) => c.completed_on === today).length;
  const todayTotal = data.activities.length;
  const todayPct = todayTotal === 0 ? 0 : Math.round((todayDone / todayTotal) * 100);

  // Range-wide completion %: total completions ÷ (active activities × days in range).
  const rangeCompletions = data.completions.length;
  const rangePossible = todayTotal * range.days;
  const rangePct = rangePossible === 0 ? 0 : Math.round((rangeCompletions / rangePossible) * 100);

  const lastGlucose = data.glucose[0];
  const inRange = data.glucose.filter((g) => g.value_mg_dl >= 70 && g.value_mg_dl <= 180).length;
  const inRangePct = data.glucose.length === 0 ? null : Math.round((inRange / data.glucose.length) * 100);
  const glucoseAvg =
    data.glucose.length === 0
      ? null
      : Math.round(data.glucose.reduce((s, g) => s + g.value_mg_dl, 0) / data.glucose.length);

  // Cycle insights reuse the same algorithm as the Period Tracker page so the
  // "next predicted" date on the dashboard never drifts from the source of truth.
  const cycle = computeCycleInsights(data.periodLogs);

  const name = data.displayName?.trim() || user?.email?.split("@")[0] || "there";

  return (
    <div className="space-y-6">
      <Hero greeting={greeting} name={name} />

      <RangeSelector value={rangeId} onChange={setRangeId} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          accent="primary"
          icon={<ActivityIcon className="h-4 w-4" />}
          label="Today"
          value={`${todayDone}/${todayTotal}`}
          hint={`${todayPct}% complete`}
        />
        <StatCard
          accent="emerald"
          icon={<TrendingUp className="h-4 w-4" />}
          label={`Last ${range.label}`}
          value={`${rangePct}%`}
          hint={`${rangeCompletions} completion${rangeCompletions === 1 ? "" : "s"}`}
        />
        <StatCard
          accent="indigo"
          icon={<Dumbbell className="h-4 w-4" />}
          label="Workouts"
          value={String(data.workouts.length)}
          hint={
            data.workouts[0]
              ? `Last: ${formatDate(data.workouts[0].performed_at)}`
              : `None in last ${range.label}`
          }
        />
        <StatCard
          accent="rose"
          icon={<Droplet className="h-4 w-4" />}
          label="In range"
          value={inRangePct === null ? "—" : `${inRangePct}%`}
          hint={
            lastGlucose
              ? `Last: ${lastGlucose.value_mg_dl} mg/dL · ${data.glucose.length} reading${data.glucose.length === 1 ? "" : "s"}`
              : `No readings in last ${range.label}`
          }
        />
      </div>

      {/* Rows below intentionally mirror the sidebar's nav order:
          Daily Routine → Gym Workout → Period Tracker → Diabetes.
          Reading order (top→bottom, left→right) follows the sidebar so the
          dashboard scans the same way users navigate the app. */}

      {/* Daily Routine row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Today's activities</CardTitle>
              <CardDescription>{todayDone} of {todayTotal} done</CardDescription>
            </div>
            <Link
              to="/daily-routine"
              className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
            >
              Open <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {data.activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activities yet — add one to start tracking.</p>
            ) : (
              <ul className="space-y-2.5">
                {data.activities.slice(0, 6).map((a) => {
                  const done = data.completions.some(
                    (c) => c.activity_id === a.id && c.completed_on === today
                  );
                  return (
                    <li key={a.id} className="flex items-center gap-3">
                      <span
                        className={cn(
                          "h-2.5 w-2.5 rounded-full transition-colors",
                          done ? "bg-primary ring-2 ring-primary/20" : "bg-muted ring-1 ring-border"
                        )}
                        aria-hidden
                      />
                      <span className={cn("text-sm", done && "line-through text-muted-foreground")}>
                        {a.icon ? `${a.icon} ` : ""}{a.name}
                      </span>
                    </li>
                  );
                })}
                {data.activities.length > 6 && (
                  <li className="text-xs text-muted-foreground">+{data.activities.length - 6} more</li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Weekly completion</CardTitle>
            <CardDescription>Activities done per day</CardDescription>
          </CardHeader>
          <CardContent>
            <WeekChart weekKeys={weekKeys} completions={data.completions} max={todayTotal || 1} />
          </CardContent>
        </Card>
      </div>

      {/* Gym Workout + Period Tracker row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Dumbbell className="h-4 w-4 text-primary" /> Recent workouts
            </CardTitle>
            <Link
              to="/gym"
              className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
            >
              Open <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {data.workouts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No workouts logged yet.</p>
            ) : (
              <ul className="divide-y divide-border -mt-2">
                {data.workouts.slice(0, 5).map((w) => (
                  <li key={w.id} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="truncate">{w.name}</span>
                    <span className="text-muted-foreground text-xs">{formatDate(w.performed_at)}</span>
                  </li>
                ))}
                {data.workouts.length > 5 && (
                  <li className="pt-2 text-[11px] text-muted-foreground">
                    +{data.workouts.length - 5} more in last {range.label}
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        <SummaryCard
          to="/health/period"
          title="Period"
          icon={<CalendarHeart className="h-4 w-4 text-rose-500" />}
          rows={[
            { label: "Last period", value: formatYmd(cycle.lastPeriodStart) },
            {
              label: "Next predicted",
              value: formatYmd(cycle.predictedNext),
              hint:
                cycle.predictedNext === null && cycle.standardNext
                  ? `Standard: ${formatYmd(cycle.standardNext)}`
                  : undefined,
            },
            {
              label: "Avg cycle",
              value: cycle.avgCycleDays === null ? "—" : `${cycle.avgCycleDays} days`,
              hint:
                cycle.cycleCount > 0
                  ? `From ${cycle.cycleCount} cycle${cycle.cycleCount === 1 ? "" : "s"}`
                  : "Need 2+ cycles",
            },
          ]}
          emptyMessage={cycle.lastPeriodStart === null ? "No period logged yet." : null}
        />
      </div>

      {/* Diabetes — summary stats and recent readings combined into one card
          so the dashboard stays compact and leaves room for future panels. */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Droplet className="h-4 w-4 text-rose-500" /> Diabetes
          </CardTitle>
          <Link
            to="/health/diabetes"
            className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
          >
            Open <ArrowRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Compact stat row — last reading / average / in-range. */}
          <div className="grid grid-cols-3 gap-3 rounded-lg border bg-muted/30 p-3">
            <DiabetesStat
              label="Last reading"
              value={lastGlucose ? `${lastGlucose.value_mg_dl}` : "—"}
              hint={lastGlucose ? `${formatDate(lastGlucose.measured_at)} · mg/dL` : "No data"}
            />
            <DiabetesStat
              label="Average"
              value={glucoseAvg === null ? "—" : `${glucoseAvg}`}
              hint={glucoseAvg === null ? "No data" : `Last ${range.label} · mg/dL`}
            />
            <DiabetesStat
              label="In range"
              value={inRangePct === null ? "—" : `${inRangePct}%`}
              hint={
                data.glucose.length > 0
                  ? `${inRange} of ${data.glucose.length}`
                  : "No data"
              }
            />
          </div>

          {/* Recent readings list. */}
          {data.glucose.length === 0 ? (
            <p className="text-sm text-muted-foreground">No glucose readings yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.glucose.slice(0, 5).map((g) => (
                <li key={g.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span>
                    <span className={cn("font-semibold", glucoseColor(g.value_mg_dl))}>
                      {g.value_mg_dl}
                    </span>{" "}
                    <span className="text-muted-foreground text-xs">
                      mg/dL · {g.meal_context?.replace(/_/g, " ") ?? "—"}
                    </span>
                  </span>
                  <span className="text-muted-foreground text-xs">{formatDate(g.measured_at)}</span>
                </li>
              ))}
              {data.glucose.length > 5 && (
                <li className="pt-2 text-[11px] text-muted-foreground">
                  +{data.glucose.length - 5} more in last {range.label}
                </li>
              )}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Hero({ greeting, name }: { greeting: string; name: string }) {
  const dateLabel = new Date().toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return (
    <div className="rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-6 md:p-8">
      <p className="text-xs font-medium uppercase tracking-wider text-primary mb-2">
        {dateLabel}
      </p>
      <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
        {greeting}, <span className="text-primary">{name}</span>
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Here&rsquo;s a snapshot of your routines, workouts, and health.
      </p>
    </div>
  );
}

function RangeSelector({
  value,
  onChange,
}: {
  value: RangeId;
  onChange: (id: RangeId) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="font-medium text-muted-foreground">Range:</span>
      <div
        role="radiogroup"
        aria-label="Dashboard time range"
        className="inline-flex rounded-md border border-input bg-background p-0.5"
      >
        {RANGE_OPTIONS.map((r) => {
          const active = r.id === value;
          return (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(r.id)}
              className={cn(
                "px-2.5 py-1 rounded-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
              )}
            >
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SummaryCard({
  to,
  title,
  icon,
  rows,
  emptyMessage,
}: {
  to: string;
  title: string;
  icon: React.ReactNode;
  rows: { label: string; value: string; hint?: string }[];
  emptyMessage: string | null;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon} {title}
        </CardTitle>
        <Link
          to={to}
          className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
        >
          Open <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent>
        {emptyMessage ? (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <dl className="divide-y divide-border -mt-2">
            {rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between py-2.5">
                <dt className="text-xs font-medium text-muted-foreground">{r.label}</dt>
                <dd className="text-right">
                  <span className="text-sm font-semibold">{r.value}</span>
                  {r.hint && (
                    <span className="ml-2 text-[11px] text-muted-foreground">{r.hint}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

/** Compact stat used inside the combined Diabetes card. */
function DiabetesStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tracking-tight truncate">{value}</p>
      <p className="text-[11px] text-muted-foreground truncate">{hint}</p>
    </div>
  );
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      {message}
    </div>
  );
}

const ACCENTS: Record<string, { tile: string; bar: string }> = {
  primary: { tile: "bg-primary/10 text-primary ring-primary/20", bar: "from-primary/40 via-primary/0" },
  emerald: {
    tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20",
    bar: "from-emerald-500/40 via-emerald-500/0",
  },
  indigo: {
    tile: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-indigo-500/20",
    bar: "from-indigo-500/40 via-indigo-500/0",
  },
  rose: {
    tile: "bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/20",
    bar: "from-rose-500/40 via-rose-500/0",
  },
};

function StatCard({
  accent,
  icon,
  label,
  value,
  hint,
}: {
  accent: keyof typeof ACCENTS;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  const a = ACCENTS[accent];
  return (
    <Card className="relative overflow-hidden">
      <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b to-transparent", a.bar)} />
      <CardContent className="p-5 relative">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-inset",
              a.tile
            )}
          >
            {icon}
          </div>
        </div>
        <p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground truncate">{hint}</p>
      </CardContent>
    </Card>
  );
}

function WeekChart({
  weekKeys,
  completions,
  max,
}: {
  weekKeys: string[];
  completions: ActivityCompletion[];
  max: number;
}) {
  const today = ymd();
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2 h-32">
        {weekKeys.map((k, i) => {
          const count = completions.filter((c) => c.completed_on === k).length;
          const heightPct = Math.min(100, (count / max) * 100);
          const isToday = k === today;
          return (
            <div key={k} className="flex-1 flex flex-col items-center gap-1.5">
              <span className="text-[10px] font-medium text-muted-foreground">
                {count > 0 ? count : ""}
              </span>
              <div className="flex-1 w-full flex items-end">
                <div
                  className={cn(
                    "w-full rounded-t-md transition-all",
                    isToday ? "bg-primary" : "bg-primary/60",
                    count === 0 && "bg-muted"
                  )}
                  style={{ height: `${Math.max(heightPct, 4)}%` }}
                />
              </div>
              <span
                className={cn(
                  "text-[10px]",
                  isToday ? "text-primary font-semibold" : "text-muted-foreground"
                )}
              >
                {DAY_LABELS[i]}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">Max {max} per day</p>
    </div>
  );
}

function glucoseColor(v: number): string {
  if (v < 70) return "text-amber-600 dark:text-amber-400";
  if (v > 180) return "text-rose-600 dark:text-rose-400";
  return "text-emerald-600 dark:text-emerald-400";
}

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return ymd(d);
}

/** Formats a `YYYY-MM-DD` date string as a localised label without the
 *  UTC-shift bug `new Date("YYYY-MM-DD")` introduces (which parses as UTC
 *  midnight and can render as the previous day in negative-offset zones). */
function formatYmd(s: string | null): string {
  if (!s) return "—";
  return formatDate(`${s}T00:00:00`);
}
