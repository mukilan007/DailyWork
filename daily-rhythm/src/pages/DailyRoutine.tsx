import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Flame,
  Check,
  Activity as ActivityIcon,
  ChevronLeft,
  ChevronRight,
  Archive,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Dialog } from "@/components/ui/Dialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { ExportButton } from "@/components/ui/ExportButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { EmojiPicker } from "@/components/ui/EmojiPicker";
import { useAuth } from "@/hooks/useAuth";
import { supabase, isMissingColumnError } from "@/lib/supabase";
import type { Activity, ActivityCategory, ActivityCompletion } from "@/types";
import { ymd, weekDates, addDays, startOfWeek, DAY_LABELS } from "@/lib/dates";
import { exportReport } from "@/lib/export";
import { cn } from "@/lib/utils";

type CategoryMeta = { value: ActivityCategory; label: string; chip: string; dot: string };

const CATEGORIES: CategoryMeta[] = [
  {
    value: "health",
    label: "Health",
    chip: "bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/20",
    dot: "bg-rose-500",
  },
  {
    value: "fitness",
    label: "Fitness",
    chip: "bg-orange-500/10 text-orange-600 dark:text-orange-400 ring-orange-500/20",
    dot: "bg-orange-500",
  },
  {
    value: "mind",
    label: "Mind",
    chip: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-indigo-500/20",
    dot: "bg-indigo-500",
  },
  {
    value: "work",
    label: "Work",
    chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-sky-500/20",
    dot: "bg-sky-500",
  },
  {
    value: "self_care",
    label: "Self-care",
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20",
    dot: "bg-emerald-500",
  },
  {
    value: "other",
    label: "Other",
    chip: "bg-slate-500/10 text-slate-600 dark:text-slate-300 ring-slate-500/20",
    dot: "bg-slate-500",
  },
];

const CATEGORY_BY_VALUE: Record<ActivityCategory, CategoryMeta> = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c])
) as Record<ActivityCategory, CategoryMeta>;

/** Compute the consecutive-days streak ending today (or yesterday if today not done). */
function computeStreak(completedDates: Set<string>, today: Date = new Date()): number {
  let streak = 0;
  const cursor = new Date(today);
  cursor.setHours(0, 0, 0, 0);
  // If today isn't completed, start counting from yesterday so the streak doesn't
  // collapse to zero just because the day isn't done yet.
  if (!completedDates.has(ymd(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (completedDates.has(ymd(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function DailyRoutinePage() {
  const { user } = useAuth();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [completions, setCompletions] = useState<ActivityCompletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Activity | null>(null);
  const [deleting, setDeleting] = useState(false);

  const today = ymd();
  const [weekAnchor, setWeekAnchor] = useState<Date>(() => startOfWeek(new Date()));
  const week = useMemo(() => weekDates(weekAnchor), [weekAnchor]);
  const weekKeys = useMemo(() => week.map((d) => ymd(d)), [week]);
  const weekStart = weekKeys[0];

  const isCurrentWeek = weekStart === ymd(startOfWeek(new Date()));

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Prefer a server-side filter so Postgres can use the
      // `activities_user_active_idx` partial index. Fall back to an
      // unfiltered query (and a client-side filter below) if the column
      // doesn't exist yet on the user's DB.
      const filteredActivities = supabase
        .from("activities")
        .select("*")
        .eq("is_archived", false)
        .order("created_at", { ascending: true });
      const [activitiesRes, completionsRes] = await Promise.all([
        filteredActivities,
        // Pull a year of completions so users can review/edit any past week.
        supabase
          .from("activity_completions")
          .select("*")
          .gte("completed_on", ymdDaysAgo(365))
          .order("completed_on", { ascending: false }),
      ]);
      if (cancelled) return;

      let activitiesData = activitiesRes.data ?? [];
      let activitiesError = activitiesRes.error;
      if (isMissingColumnError(activitiesError, "is_archived")) {
        const retry = await supabase
          .from("activities")
          .select("*")
          .order("created_at", { ascending: true });
        if (cancelled) return;
        activitiesData = (retry.data ?? []).filter((a) => !a.is_archived);
        activitiesError = retry.error;
      }

      if (activitiesError) setError(activitiesError.message);
      else if (completionsRes.error) setError(completionsRes.error.message);
      else {
        // Drop completions belonging to archived activities so the weekly
        // bar chart and any other completions-derived UI doesn't keep
        // crediting hidden habits on past dates.
        const activeIds = new Set(activitiesData.map((a) => a.id));
        const visibleCompletions = (completionsRes.data ?? []).filter((c) =>
          activeIds.has(c.activity_id)
        );
        setActivities(activitiesData);
        setCompletions(visibleCompletions);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // activity_id -> Set of YYYY-MM-DD strings
  const completedByActivity = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const c of completions) {
      if (!map.has(c.activity_id)) map.set(c.activity_id, new Set());
      map.get(c.activity_id)!.add(c.completed_on);
    }
    return map;
  }, [completions]);

  /** Toggle completion for an activity on the given date. Future dates are ignored. */
  async function toggleDate(activity: Activity, dateKey: string) {
    if (!user) return;
    if (dateKey > today) return; // can't check off the future
    const done = completedByActivity.get(activity.id)?.has(dateKey) ?? false;
    if (done) {
      // Optimistic remove
      setCompletions((prev) =>
        prev.filter((c) => !(c.activity_id === activity.id && c.completed_on === dateKey))
      );
      const { error } = await supabase
        .from("activity_completions")
        .delete()
        .eq("activity_id", activity.id)
        .eq("completed_on", dateKey);
      if (error) setError(error.message);
    } else {
      const optimistic: ActivityCompletion = {
        id: `tmp-${Date.now()}-${dateKey}`,
        user_id: user.id,
        activity_id: activity.id,
        completed_on: dateKey,
        created_at: new Date().toISOString(),
      };
      setCompletions((prev) => [optimistic, ...prev]);
      const { data, error } = await supabase
        .from("activity_completions")
        .insert({ user_id: user.id, activity_id: activity.id, completed_on: dateKey })
        .select()
        .single();
      if (error) {
        setCompletions((prev) => prev.filter((c) => c.id !== optimistic.id));
        setError(error.message);
      } else if (data) {
        setCompletions((prev) => prev.map((c) => (c.id === optimistic.id ? data : c)));
      }
    }
  }

  /**
   * Soft-delete: flips is_archived = true. The activity stays in the database
   * along with every past completion, so charts and history are preserved —
   * the row is just hidden from the active list.
   */
  async function archiveActivity(activity: Activity) {
    const prev = activities;
    setActivities((a) => a.filter((x) => x.id !== activity.id));
    const { error } = await supabase
      .from("activities")
      .update({ is_archived: true })
      .eq("id", activity.id);
    if (error) {
      setActivities(prev);
      if (isMissingColumnError(error, "is_archived")) {
        setError(
          "Archive isn't available yet — your DB is missing the latest migration. Run `npm run db:push`, or use 'Delete forever' for now."
        );
      } else {
        setError(error.message);
      }
      throw error;
    }
  }

  /**
   * Hard delete: removes the activity row. The FK ON DELETE CASCADE on
   * activity_completions wipes the entire history with it — irreversible.
   */
  async function hardDeleteActivity(activity: Activity) {
    const prev = activities;
    setActivities((a) => a.filter((x) => x.id !== activity.id));
    const { error } = await supabase.from("activities").delete().eq("id", activity.id);
    if (error) {
      setActivities(prev);
      setError(error.message);
      throw error;
    }
  }

  /**
   * Runs an archive/delete op against the currently-targeted activity with
   * shared busy-state + close-on-success bookkeeping. The op itself already
   * surfaces errors via setError, so we swallow the re-throw here.
   */
  async function runRemoval(op: (a: Activity) => Promise<void>) {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await op(deleteTarget);
      setDeleteTarget(null);
    } catch {
      /* error already surfaced via setError in the op */
    } finally {
      setDeleting(false);
    }
  }

  async function handleCreate(
    name: string,
    icon: string,
    frequency: Activity["frequency"],
    category: ActivityCategory | null
  ) {
    if (!user) return;
    const base = { user_id: user.id, name, icon: icon || null, frequency };
    let { data, error } = await supabase
      .from("activities")
      .insert({ ...base, category })
      .select()
      .single();
    // If the user hasn't applied the "activities.category" migration yet,
    // PostgREST returns PGRST204 / mentions the missing column. Retry the
    // insert without the category column so adding activities still works.
    if (isMissingColumnError(error, "category")) {
      const retry = await supabase
        .from("activities")
        .insert(base)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
      if (!error && category) {
        setError(
          "Activity added, but the 'category' column isn't in your database yet. Run `npm run db:push` to enable categories."
        );
      }
    }
    if (error) {
      setError(error.message);
      return;
    }
    if (data) setActivities((prev) => [...prev, data]);
    setAddOpen(false);
  }

  async function handleUpdate(
    id: string,
    name: string,
    icon: string,
    frequency: Activity["frequency"],
    category: ActivityCategory | null
  ) {
    if (!user) return;
    const base = { name, icon: icon || null, frequency };
    let { data, error } = await supabase
      .from("activities")
      .update({ ...base, category })
      .eq("id", id)
      .select()
      .single();
    // Same graceful fallback as handleCreate: retry without `category`
    // if the column hasn't been migrated yet.
    if (isMissingColumnError(error, "category")) {
      const retry = await supabase
        .from("activities")
        .update(base)
        .eq("id", id)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
      if (!error && category) {
        setError(
          "Activity updated, but the 'category' column isn't in your database yet. Run `npm run db:push` to enable categories."
        );
      }
    }
    if (error) {
      setError(error.message);
      return;
    }
    if (data) {
      setActivities((prev) => prev.map((a) => (a.id === id ? data! : a)));
    }
    setEditingActivity(null);
  }

  const todayDoneCount = activities.filter((a) =>
    completedByActivity.get(a.id)?.has(today)
  ).length;

  // Weekly score: how many activity-day cells in the visible week are completed,
  // counting only cells that have already happened (today and earlier).
  const { weekDoneCells, weekTotalCells } = useMemo(() => {
    let done = 0;
    let total = 0;
    for (const a of activities) {
      const set = completedByActivity.get(a.id);
      for (const k of weekKeys) {
        if (k > today) continue;
        total += 1;
        if (set?.has(k)) done += 1;
      }
    }
    return { weekDoneCells: done, weekTotalCells: total };
  }, [activities, completedByActivity, weekKeys, today]);

  const weeklyScore = weekTotalCells === 0 ? 0 : Math.round((weekDoneCells / weekTotalCells) * 100);

  const weekRangeLabel = useMemo(() => {
    const start = week[0];
    const end = week[6];
    const sameMonth = start.getMonth() === end.getMonth();
    const sameYear = start.getFullYear() === end.getFullYear();
    const startFmt = start.toLocaleDateString([], { month: "short", day: "numeric" });
    const endFmt = end.toLocaleDateString([], {
      month: sameMonth ? undefined : "short",
      day: "numeric",
      year: sameYear ? undefined : "numeric",
    });
    return `${startFmt} – ${endFmt}${sameYear ? `, ${end.getFullYear()}` : ""}`;
  }, [week]);

  function shiftWeek(deltaDays: number) {
    setWeekAnchor((d) => addDays(d, deltaDays));
  }
  function jumpToThisWeek() {
    setWeekAnchor(startOfWeek(new Date()));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Daily Routine"
        icon={<ActivityIcon className="h-5 w-5" />}
        description={
          activities.length === 0
            ? "Build the habits that make your day."
            : `${todayDoneCount} of ${activities.length} done today.`
        }
        actions={
          <div className="flex items-center gap-2">
            <ExportButton
              disabled={loading || activities.length === 0}
              onExport={(format) => {
                const activityById = new Map(activities.map((a) => [a.id, a]));
                if (format === "csv") {
                  exportReport({
                    name: "routine-completions",
                    format,
                    rows: completions.map((c) => {
                      const a = activityById.get(c.activity_id);
                      return {
                        completed_on: c.completed_on,
                        activity: a?.name ?? "(deleted)",
                        category: a?.category ?? "",
                        frequency: a?.frequency ?? "",
                        activity_id: c.activity_id,
                      };
                    }),
                    columns: ["completed_on", "activity", "category", "frequency", "activity_id"],
                  });
                } else {
                  exportReport({
                    name: "routine",
                    format,
                    rows: [
                      {
                        activities: activities.map((a) => ({
                          id: a.id,
                          name: a.name,
                          icon: a.icon,
                          category: a.category,
                          frequency: a.frequency,
                          created_at: a.created_at,
                        })),
                        completions: completions.map((c) => ({
                          activity_id: c.activity_id,
                          activity: activityById.get(c.activity_id)?.name ?? null,
                          completed_on: c.completed_on,
                        })),
                      },
                    ],
                    meta: {
                      source: "daily_routine",
                      activity_count: activities.length,
                      completion_count: completions.length,
                    },
                  });
                }
              }}
            />
            <Button onClick={() => setAddOpen(true)} disabled={loading}>
              <Plus className="h-4 w-4" /> Add Activity
            </Button>
          </div>
        }
      />

      {error && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Week navigation */}
      {!loading && activities.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous week"
              onClick={() => shiftWeek(-7)}
              className="h-8 w-8"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[10rem] text-center">
              <p className="text-sm font-medium tabular-nums">{weekRangeLabel}</p>
              {!isCurrentWeek && (
                <p className="text-[10px] text-muted-foreground">Viewing past week</p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next week"
              onClick={() => shiftWeek(7)}
              disabled={isCurrentWeek}
              className="h-8 w-8"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {!isCurrentWeek && (
              <Button variant="outline" size="sm" onClick={jumpToThisWeek} className="ml-1 h-8">
                Today
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Weekly score</span>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                weeklyScore >= 75
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20"
                  : weeklyScore >= 40
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {weeklyScore}%
            </span>
          </div>
        </div>
      )}

      {!loading && activities.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{isCurrentWeek ? "This week" : "Week overview"}</CardTitle>
            <CardDescription>Total completions per day, {weekRangeLabel}.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-32">
              {weekKeys.map((k, i) => {
                const count = completions.filter((c) => c.completed_on === k).length;
                const max = activities.length || 1;
                const heightPct = Math.min(100, (count / max) * 100);
                const isCurrent = k === today;
                return (
                  <div key={k} className="flex-1 flex flex-col items-center gap-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
                      {count > 0 ? count : ""}
                    </span>
                    <div className="flex-1 w-full flex items-end">
                      <div
                        className={cn(
                          "w-full rounded-t-md transition-all",
                          isCurrent ? "bg-primary" : "bg-primary/60",
                          count === 0 && "bg-muted"
                        )}
                        style={{ height: `${Math.max(heightPct, 4)}%` }}
                        aria-label={`${count} completions on ${DAY_LABELS[i]}`}
                      />
                    </div>
                    <span
                      className={cn(
                        "text-[10px]",
                        isCurrent ? "text-primary font-semibold" : "text-muted-foreground"
                      )}
                    >
                      {DAY_LABELS[i]}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <SkeletonList rows={3} />
      ) : activities.length === 0 ? (
        <EmptyState
          icon={<ActivityIcon className="h-7 w-7" />}
          title="No activities yet"
          description="Add your first habit to start building a daily routine. Track streaks, see weekly progress, and stay consistent."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Add your first activity
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3">
          {activities.map((a) => {
            const done = completedByActivity.get(a.id) ?? new Set<string>();
            const streak = computeStreak(done);
            const isToday = done.has(today);
            return (
              <Card key={a.id}>
                <CardContent className="p-5 flex items-center gap-4">
                  {isCurrentWeek ? (
                    <button
                      type="button"
                      onClick={() => toggleDate(a, today)}
                      aria-pressed={isToday}
                      aria-label={isToday ? "Mark today as not done" : "Mark today as done"}
                      className={cn(
                        "h-11 w-11 shrink-0 rounded-full border-2 flex items-center justify-center transition-all active:scale-95",
                        isToday
                          ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                          : "border-input hover:border-primary hover:bg-primary/5"
                      )}
                    >
                      {isToday && <Check className="h-5 w-5" strokeWidth={3} />}
                    </button>
                  ) : (
                    <div className="h-11 w-11 shrink-0 rounded-full bg-muted/40 flex items-center justify-center text-lg" aria-hidden>
                      {a.icon ?? "•"}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {a.icon && isCurrentWeek && <span aria-hidden className="text-lg">{a.icon}</span>}
                      <p className="font-medium truncate">{a.name}</p>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {a.frequency}
                      </span>
                      {a.category && CATEGORY_BY_VALUE[a.category] && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
                            CATEGORY_BY_VALUE[a.category].chip
                          )}
                        >
                          <span className={cn("h-1.5 w-1.5 rounded-full", CATEGORY_BY_VALUE[a.category].dot)} />
                          {CATEGORY_BY_VALUE[a.category].label}
                        </span>
                      )}
                    </div>

                    {/* Week strip — every past/today cell is clickable */}
                    <div className="mt-3 flex gap-1.5">
                      {weekKeys.map((k, i) => {
                        const isDone = done.has(k);
                        const isFuture = k > today;
                        const isCurrent = k === today;
                        return (
                          <div key={k} className="flex flex-col items-center gap-1">
                            <span
                              className={cn(
                                "text-[10px]",
                                isCurrent ? "text-primary font-semibold" : "text-muted-foreground"
                              )}
                            >
                              {DAY_LABELS[i]}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleDate(a, k)}
                              disabled={isFuture}
                              aria-pressed={isDone}
                              aria-label={`${DAY_LABELS[i]} ${k} — ${isDone ? "done, click to undo" : isFuture ? "future" : "not done, click to mark done"}`}
                              className={cn(
                                "h-7 w-7 rounded-md flex items-center justify-center text-xs transition-all",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                                isDone
                                  ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95"
                                  : isFuture
                                  ? "bg-muted/30 text-muted-foreground/40 cursor-not-allowed"
                                  : isCurrent
                                  ? "ring-1 ring-primary/40 bg-primary/5 hover:bg-primary/10 active:scale-95"
                                  : "bg-muted/60 hover:bg-muted active:scale-95"
                              )}
                            >
                              {isDone && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
                        streak > 0
                          ? "bg-orange-500/10 text-orange-600 dark:text-orange-400 ring-1 ring-orange-500/20"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      <Flame className="h-3.5 w-3.5" />
                      <span className="tabular-nums">{streak}</span>
                      <span className="font-normal text-[10px] opacity-80">
                        {streak === 1 ? "day" : "days"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${a.name}`}
                        onClick={() => setEditingActivity(a)}
                        className="h-8 w-8"
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${a.name}`}
                        onClick={() => setDeleteTarget(a)}
                        className="h-8 w-8"
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ActivityFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add activity"
        description="Track a new habit."
        submitLabel="Add"
        onSubmit={(name, icon, frequency, category) =>
          handleCreate(name, icon, frequency, category)
        }
      />
      <ActivityFormDialog
        open={editingActivity !== null}
        onClose={() => setEditingActivity(null)}
        title="Edit activity"
        description="Update name, icon, frequency, or category."
        submitLabel="Save"
        initial={editingActivity}
        onSubmit={(name, icon, frequency, category) =>
          editingActivity
            ? handleUpdate(editingActivity.id, name, icon, frequency, category)
            : Promise.resolve()
        }
      />
      <DeleteActivityDialog
        target={deleteTarget}
        completionCount={
          // Reuse the Map we already build for per-day check rendering rather
          // than re-scanning `completions` (up to a year of rows) every render.
          deleteTarget ? completedByActivity.get(deleteTarget.id)?.size ?? 0 : 0
        }
        busy={deleting}
        onClose={() => {
          if (deleting) return;
          setDeleteTarget(null);
        }}
        onArchive={() => runRemoval(archiveActivity)}
        onHardDelete={() => runRemoval(hardDeleteActivity)}
      />
    </div>
  );
}

function ActivityFormDialog({
  open,
  onClose,
  onSubmit,
  initial,
  title,
  description,
  submitLabel,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (
    name: string,
    icon: string,
    frequency: Activity["frequency"],
    category: ActivityCategory | null
  ) => Promise<void>;
  initial?: Activity | null;
  title: string;
  description: string;
  submitLabel: string;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [frequency, setFrequency] = useState<Activity["frequency"]>("daily");
  const [category, setCategory] = useState<ActivityCategory | null>(null);
  const [saving, setSaving] = useState(false);

  // Re-seed form whenever the dialog opens. When `initial` is provided we
  // hydrate from it (edit mode); otherwise we reset to blanks (add mode).
  useEffect(() => {
    if (!open) {
      setSaving(false);
      return;
    }
    setName(initial?.name ?? "");
    setIcon(initial?.icon ?? "");
    setFrequency(initial?.frequency ?? "daily");
    setCategory(initial?.category ?? null);
    setSaving(false);
  }, [open, initial]);

  async function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    await onSubmit(name.trim(), icon.trim(), frequency, category);
    setSaving(false);
  }

  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      <form onSubmit={handleFormSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="act-name">Name</Label>
          <Input
            id="act-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Drink 2L of water"
            maxLength={80}
            autoFocus
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="act-icon">Icon</Label>
            <EmojiPicker id="act-icon" value={icon} onChange={setIcon} placeholder="Pick emoji" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="act-freq">Frequency</Label>
            <Select
              id="act-freq"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Activity["frequency"])}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="custom">Custom</option>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Category</Label>
          <div role="radiogroup" aria-label="Category" className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => {
              const active = category === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setCategory(active ? null : c.value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-all active:scale-[0.97]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    active
                      ? c.chip
                      : "bg-muted/50 text-muted-foreground ring-transparent hover:bg-muted"
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
                  {c.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Optional — group your habits. Click again to clear.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !name.trim()}>
            {saving ? "Saving…" : submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return ymd(d);
}

/**
 * Asks the user how they want to remove an activity:
 *   - Archive (recommended) — hide from list, keep all completion history.
 *   - Delete forever — wipe the activity and every past completion.
 * Cancel just closes the dialog.
 */
function DeleteActivityDialog({
  target,
  completionCount,
  busy,
  onClose,
  onArchive,
  onHardDelete,
}: {
  target: Activity | null;
  completionCount: number;
  busy: boolean;
  onClose: () => void;
  onArchive: () => void | Promise<void>;
  onHardDelete: () => void | Promise<void>;
}) {
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={target ? `Remove "${target.name}"?` : "Remove activity?"}
      description="Choose how to handle this activity and its history."
    >
      <div className="space-y-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => onArchive()}
          className={cn(
            "w-full text-left rounded-lg border border-border bg-card p-3 transition-colors",
            "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            busy && "opacity-50 cursor-not-allowed"
          )}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-md bg-emerald-500/10 p-2 ring-1 ring-emerald-500/20">
              <Archive className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Archive</span>
                <span className="text-[10px] font-medium uppercase tracking-wider rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20 px-1.5 py-0.5">
                  Recommended
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Hide from the active list, but keep the activity and{" "}
                <span className="font-medium text-foreground">
                  {completionCount}{" "}
                  {completionCount === 1 ? "past completion" : "past completions"}
                </span>{" "}
                for your records and charts. You can restore it later.
              </p>
            </div>
          </div>
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => onHardDelete()}
          className={cn(
            "w-full text-left rounded-lg border border-destructive/30 bg-destructive/5 p-3 transition-colors",
            "hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            busy && "opacity-50 cursor-not-allowed"
          )}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-md bg-destructive/15 p-2 ring-1 ring-destructive/30">
              <Trash2 className="h-4 w-4 text-destructive" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-destructive">
                  Delete forever
                </span>
                <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Permanently remove the activity and{" "}
                <span className="font-medium text-foreground">
                  all {completionCount}{" "}
                  {completionCount === 1 ? "past completion" : "past completions"}
                </span>
                . This cannot be undone.
              </p>
            </div>
          </div>
        </button>

        <div className="flex justify-end pt-1">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
