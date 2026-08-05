import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  Flame,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonCard, SkeletonStatGrid } from "@/components/ui/Skeleton";
import { Toast, ToastKind } from "@/components/ui/Toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { addDays, DAY_LABELS, parseYmd, startOfWeek, weekDates, ymd } from "@/lib/dates";
import { computeInsights, InsightStrength } from "@/lib/insights";
import { cn } from "@/lib/utils";
import type {
  Activity,
  ActivityCompletion,
  CodingProblemRow,
  GlucoseReading,
  MoodLog,
  PlannerBlock,
  PlannerBlockKind,
  StudySession,
  Todo,
  UserSettings,
  Workout,
} from "@/types";

// Chart hues from the app's shared finance palette (src/lib/finance.ts
// PIE_COLORS). Each mini chart is single-series, so the colors distinguish
// charts (whose titles carry identity), never adjacent marks in one plot.
const CHART_COLORS = {
  habits: "#7dd3a6", // green
  solves: "#5fb3e8", // blue
  study: "#a78bfa", // violet
} as const;

const BLOCK_KINDS: PlannerBlockKind[] = ["todo", "habit", "study", "gym", "break", "other"];
const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const;

const TODOS_APPROX_NOTE =
  "Approximate: counts done todos whose occurrence, due date, or creation date falls in this week — the database has no completed-at timestamp.";

type ReviewData = {
  activities: Activity[];
  completions: ActivityCompletion[];
  todos: Todo[];
  workouts: Workout[];
  problems: CodingProblemRow[];
  studySessions: StudySession[];
  moodLogs: MoodLog[];
  glucose: GlucoseReading[];
  settings: UserSettings | null;
};

type BlockDraft = { title: string; kind: PlannerBlockKind; start: string; duration: string };
const DEFAULT_DRAFT: BlockDraft = { title: "", kind: "study", start: "09:00", duration: "60" };

export function WeeklyReviewPage() {
  const { user } = useAuth();

  // Default = the week containing YESTERDAY, so a Sunday-evening ritual
  // reviews the week that's finishing rather than the one about to start.
  const defaultWeekStart = useMemo(() => startOfWeek(addDays(new Date(), -1)), []);
  const [weekStart, setWeekStart] = useState<Date>(defaultWeekStart);
  const weekStartKey = ymd(weekStart);

  const [data, setData] = useState<ReviewData | null>(null);
  const [blocks, setBlocks] = useState<PlannerBlock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: ToastKind; message: string } | null>(null);

  const today = ymd();
  const currentWeekStartKey = ymd(startOfWeek(new Date()));
  const week = useMemo(() => weekDates(weekStart), [weekStart]);
  const weekKeys = useMemo(() => week.map((d) => ymd(d)), [week]);
  const nextWeek = useMemo(() => weekDates(addDays(weekStart, 7)), [weekStart]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const anchor = parseYmd(weekStartKey);
      // Window must cover both the 4-week chart (3 weeks before the selected
      // week) and the 60-day insights window ending today.
      const chartStart = addDays(anchor, -21);
      const insightStart = addDays(new Date(), -59);
      const fetchStart = chartStart < insightStart ? chartStart : insightStart;
      const fromYmd = ymd(fetchStart);
      const fromIso = new Date(`${fromYmd}T00:00:00`).toISOString();
      const nextStartKey = ymd(addDays(anchor, 7));
      const nextEndKey = ymd(addDays(anchor, 13));

      const [
        activitiesRes,
        completionsRes,
        todosRes,
        workoutsRes,
        problemsRes,
        studyRes,
        moodRes,
        glucoseRes,
        settingsRes,
        blocksRes,
      ] = await Promise.all([
        supabase.from("activities").select("*"),
        supabase.from("activity_completions").select("*").gte("completed_on", fromYmd),
        supabase.from("todos").select("*").or(`created_at.gte.${fromIso},due_at.gte.${fromIso}`),
        supabase.from("workouts").select("*").gte("performed_at", fromIso),
        supabase
          .from("coding_problems")
          .select("*")
          .not("solved_on", "is", null)
          .gte("solved_on", fromYmd),
        supabase.from("study_sessions").select("*").gte("studied_on", fromYmd),
        supabase.from("mood_logs").select("*").gte("log_date", fromYmd),
        supabase.from("glucose_readings").select("*").gte("measured_at", fromIso),
        supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle(),
        supabase
          .from("planner_blocks")
          .select("*")
          .gte("block_date", nextStartKey)
          .lte("block_date", nextEndKey)
          .order("start_min", { ascending: true }),
      ]);
      if (cancelled) return;

      const firstError =
        activitiesRes.error ??
        completionsRes.error ??
        todosRes.error ??
        workoutsRes.error ??
        problemsRes.error ??
        studyRes.error ??
        moodRes.error ??
        glucoseRes.error ??
        settingsRes.error ??
        blocksRes.error;
      if (firstError) {
        setError(firstError.message);
        return;
      }

      // Filter archived activities client-side so DBs without the
      // `is_archived` column still work (undefined → kept).
      const activities = ((activitiesRes.data ?? []) as Activity[]).filter((a) => !a.is_archived);
      const activeIds = new Set(activities.map((a) => a.id));

      setError(null);
      setData({
        activities,
        completions: ((completionsRes.data ?? []) as ActivityCompletion[]).filter((c) =>
          activeIds.has(c.activity_id)
        ),
        todos: (todosRes.data ?? []) as Todo[],
        workouts: (workoutsRes.data ?? []) as Workout[],
        problems: (problemsRes.data ?? []) as CodingProblemRow[],
        studySessions: (studyRes.data ?? []) as StudySession[],
        moodLogs: (moodRes.data ?? []) as MoodLog[],
        glucose: (glucoseRes.data ?? []) as GlucoseReading[],
        settings: (settingsRes.data ?? null) as UserSettings | null,
      });
      setBlocks((blocksRes.data ?? []) as PlannerBlock[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, weekStartKey]);

  // ---------------------------------------------------------------------
  // Derived numbers
  // ---------------------------------------------------------------------

  const scorecard = useMemo(() => {
    if (!data) return null;
    return {
      habits: habitStatsForWeek(data.activities, data.completions, weekKeys),
      todosDone: data.todos.filter((t) => t.is_done && todoBelongsToWeek(t, weekKeys)).length,
      solves: data.problems.filter((p) => p.solved_on && weekKeys.includes(p.solved_on)).length,
      studyMin: data.studySessions
        .filter((s) => weekKeys.includes(s.studied_on))
        .reduce((sum, s) => sum + s.minutes, 0),
      workouts: data.workouts.filter((w) => weekKeys.includes(ymd(new Date(w.performed_at))))
        .length,
      avgMood: (() => {
        const moods = data.moodLogs.filter((m) => weekKeys.includes(m.log_date)).map((m) => m.mood);
        return moods.length === 0
          ? null
          : Math.round((moods.reduce((s, m) => s + m, 0) / moods.length) * 10) / 10;
      })(),
    };
  }, [data, weekKeys]);

  const streaks = useMemo(() => {
    if (!data) return [];
    const doneByActivity = new Map<string, Set<string>>();
    for (const c of data.completions) {
      let set = doneByActivity.get(c.activity_id);
      if (!set) doneByActivity.set(c.activity_id, (set = new Set()));
      set.add(c.completed_on);
    }
    const elapsedKeys = weekKeys.filter((k) => k <= today);
    return data.activities
      .filter((a) => a.frequency === "daily")
      .map((a) => {
        const done = doneByActivity.get(a.id) ?? new Set<string>();
        const missed = elapsedKeys.find((k) => !done.has(k));
        const missedIndex = missed ? weekKeys.indexOf(missed) : -1;
        return {
          activity: a,
          doneCount: elapsedKeys.filter((k) => done.has(k)).length,
          elapsed: elapsedKeys.length,
          kept: elapsedKeys.length > 0 && !missed,
          weekComplete: elapsedKeys.length === 7,
          brokeOn: missedIndex >= 0 ? DAY_LABELS[missedIndex] : null,
        };
      });
  }, [data, weekKeys, today]);

  const chartWeeks = useMemo(() => {
    if (!data) return [];
    const anchor = parseYmd(weekStartKey);
    return [3, 2, 1, 0].map((back) => {
      const start = addDays(anchor, -7 * back);
      const keys = Array.from({ length: 7 }, (_, i) => ymd(addDays(start, i)));
      const habits = habitStatsForWeek(data.activities, data.completions, keys);
      return {
        label: start.toLocaleDateString([], { month: "short", day: "numeric" }),
        selected: back === 0,
        habitPct: habits.pct ?? 0,
        solves: data.problems.filter((p) => p.solved_on && keys.includes(p.solved_on)).length,
        studyHours:
          Math.round(
            (data.studySessions
              .filter((s) => keys.includes(s.studied_on))
              .reduce((sum, s) => sum + s.minutes, 0) /
              60) *
              10
          ) / 10,
      };
    });
  }, [data, weekStartKey]);

  const insights = useMemo(() => {
    if (!data) return [];
    // Restrict to the trailing 60 days ending today — the fetch window can be
    // wider when the user is reviewing an older week.
    const fromYmdKey = ymd(addDays(new Date(), -59));
    const fromIso = new Date(`${fromYmdKey}T00:00:00`).toISOString();
    return computeInsights(
      {
        activities: data.activities,
        completions: data.completions.filter((c) => c.completed_on >= fromYmdKey),
        workouts: data.workouts.filter((w) => w.performed_at >= fromIso),
        problems: data.problems.filter((p) => (p.solved_on ?? "") >= fromYmdKey),
        studySessions: data.studySessions.filter((s) => s.studied_on >= fromYmdKey),
        moodLogs: data.moodLogs.filter((m) => m.log_date >= fromYmdKey),
        glucose: data.glucose.filter((g) => g.measured_at >= fromIso),
      },
      { days: 60 }
    ).slice(0, 5);
  }, [data]);

  // ---------------------------------------------------------------------
  // Plan-next-week mutations
  // ---------------------------------------------------------------------

  const [drafts, setDrafts] = useState<Record<string, BlockDraft>>({});
  const [savingDay, setSavingDay] = useState<string | null>(null);
  const pendingAdds = useRef(new Set<string>());
  const pendingDeletes = useRef(new Set<string>());

  function draftFor(dateKey: string): BlockDraft {
    return drafts[dateKey] ?? DEFAULT_DRAFT;
  }
  function setDraft(dateKey: string, patch: Partial<BlockDraft>) {
    setDrafts((prev) => ({ ...prev, [dateKey]: { ...draftFor(dateKey), ...patch } }));
  }

  async function addBlock(e: FormEvent, dateKey: string) {
    e.preventDefault();
    if (!user) return;
    const d = draftFor(dateKey);
    const title = d.title.trim();
    if (!title) return;
    // Double-submit guard: one in-flight insert per day row.
    if (pendingAdds.current.has(dateKey)) return;
    pendingAdds.current.add(dateKey);
    setSavingDay(dateKey);
    try {
      const startMin = timeToMinutes(d.start);
      // Upsert with ignoreDuplicates rides the planner_blocks unique index
      // (user_id, block_date, start_min, title): a duplicate inserts nothing
      // and returns zero rows instead of erroring — no duplicate rows, ever.
      const { data: rows, error: err } = await supabase
        .from("planner_blocks")
        .upsert(
          [
            {
              user_id: user.id,
              block_date: dateKey,
              start_min: startMin,
              duration_min: Number(d.duration),
              title,
              kind: d.kind,
            },
          ],
          { onConflict: "user_id,block_date,start_min,title", ignoreDuplicates: true }
        )
        .select();
      if (err) {
        setNotice({ kind: "error", message: err.message });
      } else if (!rows || rows.length === 0) {
        setNotice({
          kind: "info",
          message: `"${title}" at ${minutesToLabel(startMin)} is already planned for that day — nothing added.`,
        });
      } else {
        setBlocks((prev) =>
          [...prev, ...(rows as PlannerBlock[])].sort((a, b) => a.start_min - b.start_min)
        );
        setDraft(dateKey, { title: "" });
      }
    } finally {
      pendingAdds.current.delete(dateKey);
      setSavingDay(null);
    }
  }

  async function deleteBlock(block: PlannerBlock) {
    if (pendingDeletes.current.has(block.id)) return;
    pendingDeletes.current.add(block.id);
    const prev = blocks;
    setBlocks((cur) => cur.filter((b) => b.id !== block.id));
    try {
      const { error: err } = await supabase.from("planner_blocks").delete().eq("id", block.id);
      if (err) {
        setBlocks(prev);
        setNotice({ kind: "error", message: err.message });
      }
    } finally {
      pendingDeletes.current.delete(block.id);
    }
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const weekRangeLabel = useMemo(() => {
    const start = week[0];
    const end = week[6];
    const sameMonth = start.getMonth() === end.getMonth();
    const startFmt = start.toLocaleDateString([], { month: "short", day: "numeric" });
    const endFmt = end.toLocaleDateString([], {
      month: sameMonth ? undefined : "short",
      day: "numeric",
    });
    return `${startFmt} – ${endFmt}, ${end.getFullYear()}`;
  }, [week]);

  const atCurrentWeek = weekStartKey >= currentWeekStartKey;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Weekly Review"
        icon={<CalendarCheck2 className="h-5 w-5" />}
        description="Score the week, spot patterns, and plan the next one."
      />

      {notice && (
        <Toast kind={notice.kind} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      {/* Week switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous week"
            onClick={() => setWeekStart((d) => addDays(d, -7))}
            className="h-8 w-8"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[11rem] text-center">
            <p className="text-sm font-medium tabular-nums">{weekRangeLabel}</p>
            {weekStartKey === ymd(defaultWeekStart) && (
              <p className="text-[10px] text-muted-foreground">Week under review</p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next week"
            onClick={() => setWeekStart((d) => addDays(d, 7))}
            disabled={atCurrentWeek}
            className="h-8 w-8"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {weekStartKey !== ymd(defaultWeekStart) && (
            <Button
              variant="outline"
              size="sm"
              className="ml-1 h-8"
              onClick={() => setWeekStart(defaultWeekStart)}
            >
              This review
            </Button>
          )}
        </div>
        <span className="text-xs text-muted-foreground">Mon – Sun</span>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {!data || !scorecard ? (
        <>
          <SkeletonStatGrid count={6} />
          <SkeletonCard rows={4} />
          <SkeletonCard rows={4} />
        </>
      ) : (
        <>
          {/* Insights — the headline feature, so it sits right under the switcher. */}
          <Card className="relative overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-primary/10 to-transparent" />
            <CardHeader className="relative">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Auto-analysis insights
              </CardTitle>
              <CardDescription>
                Patterns found in your last 60 days of logs. Correlation, not causation.
              </CardDescription>
            </CardHeader>
            <CardContent className="relative">
              {insights.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Not enough data for a confident pattern yet — keep logging moods, study
                  sessions, workouts, and solves, and insights will appear here.
                </p>
              ) : (
                <ul className="space-y-3">
                  {insights.map((ins) => (
                    <li key={ins.id} className="rounded-lg border bg-muted/20 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <StrengthBadge strength={ins.strength} />
                        <p className="text-sm font-medium">{ins.text}</p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{ins.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Scorecard */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ScoreStat
              label="Habit completion"
              value={scorecard.habits.pct === null ? "—" : `${scorecard.habits.pct}%`}
              hint={
                scorecard.habits.possible === 0
                  ? "No daily/weekly habits"
                  : `${scorecard.habits.done} of ${scorecard.habits.possible} check-ins`
              }
            />
            <ScoreStat
              label="Todos completed"
              value={String(scorecard.todosDone)}
              hint="approx — hover for how"
              title={TODOS_APPROX_NOTE}
            />
            <ScoreStat
              label="Problems solved"
              value={String(scorecard.solves)}
              hint="from the coding tracker"
            />
            <ScoreStat
              label="Study time"
              value={`${scorecard.studyMin} min`}
              hint={
                data.settings && data.settings.weekly_study_target_min > 0
                  ? `${Math.round((scorecard.studyMin / data.settings.weekly_study_target_min) * 100)}% of ${data.settings.weekly_study_target_min} min target`
                  : "no weekly target set"
              }
            />
            <ScoreStat
              label="Workouts"
              value={String(scorecard.workouts)}
              hint="sessions this week"
            />
            <ScoreStat
              label="Avg mood"
              value={scorecard.avgMood === null ? "—" : `${scorecard.avgMood} / 5`}
              hint={scorecard.avgMood === null ? "no mood logs this week" : "across all logs"}
            />
          </div>

          {/* Streaks kept / broken */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Flame className="h-4 w-4 text-orange-500" /> Streaks this week
              </CardTitle>
              <CardDescription>
                Daily habits — kept means completed every elapsed day of the week.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {streaks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No daily habits to track.</p>
              ) : (
                <ul className="divide-y divide-border -my-1">
                  {streaks.map((s) => (
                    <li
                      key={s.activity.id}
                      className="flex items-center justify-between gap-3 py-2.5 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        {s.activity.icon ? `${s.activity.icon} ` : ""}
                        {s.activity.name}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {s.doneCount}/{s.elapsed}
                        </span>
                        {s.elapsed === 0 ? (
                          <Badge variant="secondary">Not started</Badge>
                        ) : s.kept ? (
                          <Badge variant="success">
                            {s.weekComplete ? "Kept all 7" : "On track"}
                          </Badge>
                        ) : (
                          <Badge variant="destructive">Broke on {s.brokeOn}</Badge>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Week-over-week — three single-axis small multiples (habit %, solves,
              study hours use different units, so they never share one axis). */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4 text-primary" /> Week over week
              </CardTitle>
              <CardDescription>
                The last 4 weeks side by side — the highlighted bar is the selected week.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 sm:grid-cols-3">
                <MiniWeekChart
                  title="Habits %"
                  color={CHART_COLORS.habits}
                  unit="%"
                  data={chartWeeks.map((w) => ({
                    label: w.label,
                    value: w.habitPct,
                    selected: w.selected,
                  }))}
                />
                <MiniWeekChart
                  title="Solves"
                  color={CHART_COLORS.solves}
                  unit=""
                  data={chartWeeks.map((w) => ({
                    label: w.label,
                    value: w.solves,
                    selected: w.selected,
                  }))}
                />
                <MiniWeekChart
                  title="Study hours"
                  color={CHART_COLORS.study}
                  unit="h"
                  data={chartWeeks.map((w) => ({
                    label: w.label,
                    value: w.studyHours,
                    selected: w.selected,
                  }))}
                />
              </div>
            </CardContent>
          </Card>

          {/* Plan next week */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarCheck2 className="h-4 w-4 text-primary" /> Plan next week
              </CardTitle>
              <CardDescription>
                Quick-add time blocks for{" "}
                {nextWeek[0].toLocaleDateString([], { month: "short", day: "numeric" })} –{" "}
                {nextWeek[6].toLocaleDateString([], { month: "short", day: "numeric" })}. Fine
                editing lives on the Today page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {nextWeek.map((d, i) => {
                const dateKey = ymd(d);
                const dayBlocks = blocks.filter((b) => b.block_date === dateKey);
                const draft = draftFor(dateKey);
                const saving = savingDay === dateKey;
                return (
                  <div key={dateKey} className="rounded-lg border p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {DAY_LABELS[i]}{" "}
                      <span className="font-normal normal-case tracking-normal">
                        · {d.toLocaleDateString([], { month: "short", day: "numeric" })}
                      </span>
                    </p>

                    {dayBlocks.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {dayBlocks.map((b) => (
                          <li
                            key={b.id}
                            className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-sm"
                          >
                            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                              {minutesToLabel(b.start_min)} · {b.duration_min}m
                            </span>
                            <span className="min-w-0 flex-1 truncate">{b.title}</span>
                            <Badge variant="secondary" className="capitalize shrink-0">
                              {b.kind}
                            </Badge>
                            <button
                              type="button"
                              aria-label={`Delete "${b.title}"`}
                              onClick={() => void deleteBlock(b)}
                              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <form
                      onSubmit={(e) => void addBlock(e, dateKey)}
                      className="mt-2 flex flex-wrap items-center gap-2"
                    >
                      <Input
                        value={draft.title}
                        onChange={(e) => setDraft(dateKey, { title: e.target.value })}
                        placeholder="Add a block…"
                        maxLength={80}
                        aria-label={`Block title for ${DAY_LABELS[i]}`}
                        className="h-8 min-w-[8rem] flex-1 text-sm"
                      />
                      <Select
                        value={draft.kind}
                        onChange={(e) =>
                          setDraft(dateKey, { kind: e.target.value as PlannerBlockKind })
                        }
                        aria-label={`Block kind for ${DAY_LABELS[i]}`}
                        className="h-8 w-24 px-2 text-xs capitalize"
                      >
                        {BLOCK_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </Select>
                      <Input
                        type="time"
                        value={draft.start}
                        onChange={(e) => setDraft(dateKey, { start: e.target.value || "09:00" })}
                        aria-label={`Start time for ${DAY_LABELS[i]}`}
                        className="h-8 w-28 text-xs"
                      />
                      <Select
                        value={draft.duration}
                        onChange={(e) => setDraft(dateKey, { duration: e.target.value })}
                        aria-label={`Duration for ${DAY_LABELS[i]}`}
                        className="h-8 w-24 px-2 text-xs"
                      >
                        {DURATION_OPTIONS.map((m) => (
                          <option key={m} value={m}>
                            {m} min
                          </option>
                        ))}
                      </Select>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={saving || !draft.title.trim()}
                        className="h-8"
                      >
                        <Plus className="h-3.5 w-3.5" /> {saving ? "Adding…" : "Add"}
                      </Button>
                    </form>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Habit completion for one week: completions ÷ (daily activities × 7 +
 * weekly activities × 1). Custom-frequency habits are excluded from both
 * sides since they have no defined weekly quota.
 */
function habitStatsForWeek(
  activities: Activity[],
  completions: ActivityCompletion[],
  weekKeys: string[]
): { pct: number | null; done: number; possible: number } {
  const daily = activities.filter((a) => a.frequency === "daily");
  const weekly = activities.filter((a) => a.frequency === "weekly");
  const possible = daily.length * 7 + weekly.length;
  const counted = new Set([...daily, ...weekly].map((a) => a.id));
  const inWeek = new Set(weekKeys);
  const done = completions.filter(
    (c) => counted.has(c.activity_id) && inWeek.has(c.completed_on)
  ).length;
  return {
    pct: possible === 0 ? null : Math.min(100, Math.round((done / possible) * 100)),
    done,
    possible,
  };
}

/**
 * Approximation for "completed this week": the schema has no completed_at,
 * so a done todo counts if its occurrence date, due date, or creation date
 * falls inside the week. Stated to the user via TODOS_APPROX_NOTE.
 */
function todoBelongsToWeek(t: Todo, weekKeys: string[]): boolean {
  const inWeek = new Set(weekKeys);
  if (t.recurrence_due_on) return inWeek.has(t.recurrence_due_on);
  if (t.due_at) return inWeek.has(ymd(new Date(t.due_at)));
  return inWeek.has(ymd(new Date(t.created_at)));
}

/** "09:30" → 570 minutes from midnight (clamped to 0..1439). */
function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (Number.isFinite(h) ? h : 9) * 60 + (Number.isFinite(m) ? m : 0);
  return Math.min(1439, Math.max(0, total));
}

/** 570 → "9:30 AM". */
function minutesToLabel(min: number): string {
  const d = new Date();
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

const STRENGTH_META: Record<
  InsightStrength,
  { label: string; variant: "success" | "info" | "secondary" }
> = {
  strong: { label: "Strong", variant: "success" },
  moderate: { label: "Moderate", variant: "info" },
  weak: { label: "Weak", variant: "secondary" },
};

function StrengthBadge({ strength }: { strength: InsightStrength }) {
  const meta = STRENGTH_META[strength];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

function ScoreStat({
  label,
  value,
  hint,
  title,
}: {
  label: string;
  value: string;
  hint: string;
  title?: string;
}) {
  return (
    <Card title={title} className={cn(title && "cursor-help")}>
      <CardContent className="p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground truncate" title={title}>
          {hint}
        </p>
      </CardContent>
    </Card>
  );
}

type MiniBarDatum = { label: string; value: number; selected: boolean };

/**
 * One small-multiple bar chart: a single series over 4 weeks with its own
 * implicit scale. Value labels sit on the bars (so no y-axis is needed) and
 * `currentColor` ticks inherit the muted text token in both themes.
 */
function MiniWeekChart({
  title,
  data,
  color,
  unit,
}: {
  title: string;
  data: MiniBarDatum[];
  color: string;
  unit: string;
}) {
  return (
    <div className="text-muted-foreground">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider">{title}</p>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data} margin={{ top: 18, right: 4, bottom: 0, left: 4 }}>
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "currentColor" }}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: "rgba(148, 163, 184, 0.12)" }}
            formatter={(v: number) => [`${v}${unit}`, title]}
            wrapperStyle={{ fontSize: "12px" }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={30} isAnimationActive={false}>
            <LabelList
              dataKey="value"
              position="top"
              formatter={(v: number) => `${v}${unit}`}
              style={{ fontSize: 10, fill: "currentColor" }}
            />
            {data.map((d) => (
              <Cell key={d.label} fill={color} fillOpacity={d.selected ? 1 : 0.55} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
