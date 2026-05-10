import { FormEvent, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Flame, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Dialog } from "@/components/ui/Dialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import type { Activity, ActivityCompletion } from "@/types";
import { ymd, weekDates, DAY_LABELS } from "@/lib/dates";

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

  const today = ymd();
  const week = useMemo(() => weekDates(), []);
  const weekKeys = useMemo(() => week.map((d) => ymd(d)), [week]);
  const weekStart = weekKeys[0];

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [activitiesRes, completionsRes] = await Promise.all([
        supabase.from("activities").select("*").order("created_at", { ascending: true }),
        // Pull last 60 days for streak math + this-week display.
        supabase
          .from("activity_completions")
          .select("*")
          .gte("completed_on", ymdDaysAgo(60))
          .order("completed_on", { ascending: false }),
      ]);
      if (cancelled) return;
      if (activitiesRes.error) setError(activitiesRes.error.message);
      else if (completionsRes.error) setError(completionsRes.error.message);
      else {
        setActivities(activitiesRes.data ?? []);
        setCompletions(completionsRes.data ?? []);
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

  async function toggleToday(activity: Activity) {
    if (!user) return;
    const done = completedByActivity.get(activity.id)?.has(today) ?? false;
    if (done) {
      // Optimistic remove
      setCompletions((prev) =>
        prev.filter((c) => !(c.activity_id === activity.id && c.completed_on === today))
      );
      const { error } = await supabase
        .from("activity_completions")
        .delete()
        .eq("activity_id", activity.id)
        .eq("completed_on", today);
      if (error) setError(error.message);
    } else {
      const optimistic: ActivityCompletion = {
        id: `tmp-${Date.now()}`,
        user_id: user.id,
        activity_id: activity.id,
        completed_on: today,
        created_at: new Date().toISOString(),
      };
      setCompletions((prev) => [optimistic, ...prev]);
      const { data, error } = await supabase
        .from("activity_completions")
        .insert({ user_id: user.id, activity_id: activity.id, completed_on: today })
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

  async function deleteActivity(activity: Activity) {
    if (!confirm(`Delete "${activity.name}"? Past completions will also be removed.`)) return;
    const prev = activities;
    setActivities((a) => a.filter((x) => x.id !== activity.id));
    const { error } = await supabase.from("activities").delete().eq("id", activity.id);
    if (error) {
      setActivities(prev);
      setError(error.message);
    }
  }

  async function handleCreate(name: string, icon: string, frequency: Activity["frequency"]) {
    if (!user) return;
    const { data, error } = await supabase
      .from("activities")
      .insert({ user_id: user.id, name, icon: icon || null, frequency })
      .select()
      .single();
    if (error) {
      setError(error.message);
      return;
    }
    if (data) setActivities((prev) => [...prev, data]);
    setAddOpen(false);
  }

  const todayDoneCount = activities.filter((a) =>
    completedByActivity.get(a.id)?.has(today)
  ).length;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Daily Routine</h1>
          <p className="text-muted-foreground">
            {activities.length === 0
              ? "Build the habits that make your day."
              : `${todayDoneCount} of ${activities.length} done today.`}
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} disabled={loading}>
          <Plus className="h-4 w-4" /> Add Activity
        </Button>
      </header>

      {error && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : activities.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No activities yet. Click <strong>Add Activity</strong> to start.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {activities.map((a) => {
            const done = completedByActivity.get(a.id) ?? new Set<string>();
            const streak = computeStreak(done);
            const isToday = done.has(today);
            return (
              <Card key={a.id}>
                <CardContent className="p-5 flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => toggleToday(a)}
                    aria-pressed={isToday}
                    aria-label={isToday ? "Mark as not done" : "Mark as done"}
                    className={`h-10 w-10 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
                      isToday
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-input hover:border-primary"
                    }`}
                  >
                    {isToday && <Check className="h-5 w-5" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {a.icon && <span aria-hidden>{a.icon}</span>}
                      <p className="font-medium truncate">{a.name}</p>
                    </div>
                    <p className="text-xs text-muted-foreground capitalize">{a.frequency}</p>

                    {/* Week strip */}
                    <div className="mt-3 flex gap-1">
                      {weekKeys.map((k, i) => (
                        <div key={k} className="flex flex-col items-center gap-1">
                          <span className="text-[10px] text-muted-foreground">{DAY_LABELS[i]}</span>
                          <span
                            aria-label={`${DAY_LABELS[i]} ${done.has(k) ? "done" : "not done"}`}
                            className={`h-3 w-6 rounded-sm ${
                              done.has(k)
                                ? "bg-primary"
                                : k <= today
                                ? "bg-muted"
                                : "bg-muted/40"
                            }`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="text-right space-y-2">
                    <div className="flex items-center justify-end gap-1 text-sm font-medium">
                      <Flame className="h-4 w-4 text-orange-500" />
                      {streak}
                      <span className="text-muted-foreground font-normal text-xs">
                        {streak === 1 ? "day" : "days"}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${a.name}`}
                      onClick={() => deleteActivity(a)}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>This week</CardTitle>
          <CardDescription>
            Total completions per day, week of {new Date(weekStart).toLocaleDateString([], { month: "short", day: "numeric" })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-2 h-28">
            {weekKeys.map((k, i) => {
              const count = completions.filter((c) => c.completed_on === k).length;
              const max = activities.length || 1;
              const heightPct = Math.min(100, (count / max) * 100);
              return (
                <div key={k} className="flex-1 flex flex-col items-center gap-1">
                  <div className="flex-1 w-full flex items-end">
                    <div
                      className="w-full bg-primary/80 rounded-t-sm transition-all"
                      style={{ height: `${heightPct}%` }}
                      aria-label={`${count} completions on ${DAY_LABELS[i]}`}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">{DAY_LABELS[i]}</span>
                  <span className="text-[10px] font-medium">{count}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <AddActivityDialog open={addOpen} onClose={() => setAddOpen(false)} onCreate={handleCreate} />
    </div>
  );
}

function AddActivityDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, icon: string, frequency: Activity["frequency"]) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [frequency, setFrequency] = useState<Activity["frequency"]>("daily");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setIcon("");
      setFrequency("daily");
      setSaving(false);
    }
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    await onCreate(name.trim(), icon.trim(), frequency);
    setSaving(false);
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add activity" description="Track a new habit.">
      <form onSubmit={onSubmit} className="space-y-4">
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
            <Label htmlFor="act-icon">Icon (emoji)</Label>
            <Input
              id="act-icon"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="💧"
              maxLength={4}
            />
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
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Add"}
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
