import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity as ActivityIcon,
  Dumbbell,
  Heart,
  Droplet,
  TrendingUp,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { SkeletonStatGrid, SkeletonCard } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import type { Activity, ActivityCompletion, Workout, GlucoseReading } from "@/types";
import { ymd, weekDates, DAY_LABELS, formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

interface HomeData {
  activities: Activity[];
  completions: ActivityCompletion[];
  workouts: Workout[];
  glucose: GlucoseReading[];
  displayName: string | null;
}

export function HomePage() {
  const { user } = useAuth();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const sevenDaysAgo = ymdDaysAgo(7);
      const [activitiesRes, completionsRes, workoutsRes, glucoseRes, profileRes] = await Promise.all([
        supabase.from("activities").select("*"),
        supabase.from("activity_completions").select("*").gte("completed_on", sevenDaysAgo),
        supabase
          .from("workouts")
          .select("*")
          .order("performed_at", { ascending: false })
          .limit(5),
        supabase
          .from("glucose_readings")
          .select("*")
          .order("measured_at", { ascending: false })
          .limit(5),
        supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      const firstError =
        activitiesRes.error ??
        completionsRes.error ??
        workoutsRes.error ??
        glucoseRes.error ??
        profileRes.error;
      if (firstError) {
        setError(firstError.message);
        return;
      }
      setData({
        activities: activitiesRes.data ?? [],
        completions: completionsRes.data ?? [],
        workouts: workoutsRes.data ?? [],
        glucose: glucoseRes.data ?? [],
        displayName: profileRes.data?.display_name ?? null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const today = ymd();
  const greeting = useMemo(() => greetingFor(new Date()), []);
  const week = useMemo(() => weekDates(), []);
  const weekKeys = useMemo(() => week.map((d) => ymd(d)), [week]);

  if (error) {
    return (
      <div className="space-y-6">
        <Hero greeting={greeting} name="" />
        <ErrorAlert message={error} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <Hero greeting={greeting} name="…" />
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

  const weeklyCompletions = data.completions.length;
  const weeklyPossible = todayTotal * 7;
  const weeklyPct = weeklyPossible === 0 ? 0 : Math.round((weeklyCompletions / weeklyPossible) * 100);

  const lastGlucose = data.glucose[0];
  const inRange = data.glucose.filter((g) => g.value_mg_dl >= 70 && g.value_mg_dl <= 180).length;
  const inRangePct = data.glucose.length === 0 ? null : Math.round((inRange / data.glucose.length) * 100);

  const name = data.displayName?.trim() || user?.email?.split("@")[0] || "there";

  return (
    <div className="space-y-6">
      <Hero greeting={greeting} name={name} />

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
          label="This week"
          value={`${weeklyPct}%`}
          hint={`${weeklyCompletions} completions`}
        />
        <StatCard
          accent="indigo"
          icon={<Dumbbell className="h-4 w-4" />}
          label="Workouts"
          value={String(data.workouts.length)}
          hint={data.workouts[0] ? `Last: ${formatDate(data.workouts[0].performed_at)}` : "No workouts yet"}
        />
        <StatCard
          accent="rose"
          icon={<Droplet className="h-4 w-4" />}
          label="In range"
          value={inRangePct === null ? "—" : `${inRangePct}%`}
          hint={lastGlucose ? `Last: ${lastGlucose.value_mg_dl} mg/dL` : "No readings yet"}
        />
      </div>

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
                {data.workouts.map((w) => (
                  <li key={w.id} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="truncate">{w.name}</span>
                    <span className="text-muted-foreground text-xs">{formatDate(w.performed_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Heart className="h-4 w-4 text-rose-500" /> Health
            </CardTitle>
            <div className="flex gap-3 text-xs font-medium">
              <Link to="/health/diabetes" className="text-primary hover:underline">
                Diabetes
              </Link>
              <Link to="/health/period" className="text-primary hover:underline">
                Period
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {data.glucose.length === 0 ? (
              <p className="text-sm text-muted-foreground">No glucose readings yet.</p>
            ) : (
              <ul className="divide-y divide-border -mt-2">
                {data.glucose.map((g) => (
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
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
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
