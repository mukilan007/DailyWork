import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity as ActivityIcon, Dumbbell, Heart, Droplet, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import type { Activity, ActivityCompletion, Workout, GlucoseReading } from "@/types";
import { ymd, weekDates, DAY_LABELS, formatDate } from "@/lib/dates";

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
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">Home</h1>
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">Home</h1>
        <p className="text-muted-foreground">Loading…</p>
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
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          {greeting}, {name}
        </h1>
        <p className="text-muted-foreground">{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<ActivityIcon className="h-4 w-4" />}
          label="Today's progress"
          value={`${todayDone}/${todayTotal}`}
          hint={`${todayPct}% complete`}
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="This week"
          value={`${weeklyPct}%`}
          hint={`${weeklyCompletions} completions`}
        />
        <StatCard
          icon={<Dumbbell className="h-4 w-4" />}
          label="Recent workouts"
          value={String(data.workouts.length)}
          hint={data.workouts[0] ? `Last: ${formatDate(data.workouts[0].performed_at)}` : "No workouts yet"}
        />
        <StatCard
          icon={<Droplet className="h-4 w-4" />}
          label="Glucose in range"
          value={inRangePct === null ? "—" : `${inRangePct}%`}
          hint={lastGlucose ? `Last: ${lastGlucose.value_mg_dl} mg/dL` : "No readings yet"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Today's activities</CardTitle>
            <CardDescription>
              <Link to="/daily-routine" className="hover:underline text-primary">
                Open daily routine →
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activities yet — add one to start tracking.</p>
            ) : (
              <ul className="space-y-2">
                {data.activities.slice(0, 6).map((a) => {
                  const done = data.completions.some(
                    (c) => c.activity_id === a.id && c.completed_on === today
                  );
                  return (
                    <li key={a.id} className="flex items-center gap-3">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${done ? "bg-primary" : "bg-muted"}`}
                        aria-hidden
                      />
                      <span className={done ? "line-through text-muted-foreground" : ""}>
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
            <div className="flex items-end gap-2 h-32">
              {weekKeys.map((k, i) => {
                const count = data.completions.filter((c) => c.completed_on === k).length;
                const max = todayTotal || 1;
                const heightPct = Math.min(100, (count / max) * 100);
                return (
                  <div key={k} className="flex-1 flex flex-col items-center gap-1">
                    <div className="flex-1 w-full flex items-end">
                      <div
                        className="w-full bg-primary rounded-t-sm transition-all"
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{DAY_LABELS[i]}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Dumbbell className="h-5 w-5" /> Recent workouts
            </CardTitle>
            <CardDescription>
              <Link to="/gym" className="hover:underline text-primary">
                Open gym →
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.workouts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No workouts logged yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.workouts.map((w) => (
                  <li key={w.id} className="flex items-center justify-between text-sm">
                    <span className="truncate">{w.name}</span>
                    <span className="text-muted-foreground text-xs">{formatDate(w.performed_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Heart className="h-5 w-5" /> Health
            </CardTitle>
            <CardDescription>
              <Link to="/health/diabetes" className="hover:underline text-primary mr-3">
                Diabetes →
              </Link>
              <Link to="/health/period" className="hover:underline text-primary">
                Period →
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.glucose.length === 0 ? (
              <p className="text-sm text-muted-foreground">No glucose readings yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.glucose.map((g) => (
                  <li key={g.id} className="flex items-center justify-between text-sm">
                    <span>
                      <span className="font-medium">{g.value_mg_dl}</span>{" "}
                      <span className="text-muted-foreground text-xs">mg/dL · {g.meal_context ?? "—"}</span>
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

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <CardContent className="p-5 space-y-1">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
          {icon}
        </div>
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
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
