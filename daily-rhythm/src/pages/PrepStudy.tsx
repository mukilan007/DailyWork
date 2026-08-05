import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Target,
  Trash2,
  X,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { DateField } from "@/components/ui/DateField";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { addDays, DAY_LABELS, parseYmd, startOfWeek, weekDates, ymd } from "@/lib/dates";
import {
  formatMinutes,
  PREP_CHART_COLORS,
  TOPIC_BAR_COLORS,
} from "@/lib/prep";
import type { StudySession, UserSettings } from "@/types";
import { cn } from "@/lib/utils";

export function PrepStudyPage() {
  const { user } = useAuth();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek());
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [knownTopics, setKnownTopics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quick-add row state
  const [addDate, setAddDate] = useState(ymd());
  const [addTopic, setAddTopic] = useState("");
  const [addMinutes, setAddMinutes] = useState("");
  const [addNote, setAddNote] = useState("");
  const [adding, setAdding] = useState(false);

  // Weekly target inline editing
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetHours, setTargetHours] = useState("");
  const [savingTarget, setSavingTarget] = useState(false);

  const weekStartYmd = ymd(weekStart);
  const weekEndYmd = ymd(addDays(weekStart, 6));

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [sessRes, settingsRes, topicsRes] = await Promise.all([
        supabase
          .from("study_sessions")
          .select("*")
          .gte("studied_on", weekStartYmd)
          .lte("studied_on", weekEndYmd)
          .order("studied_on")
          .order("created_at"),
        supabase.from("user_settings").select("*").maybeSingle(),
        supabase
          .from("study_sessions")
          .select("topic")
          .order("created_at", { ascending: false })
          .limit(300),
      ]);
      if (cancelled) return;
      if (sessRes.error) setError(sessRes.error.message);
      else setSessions((sessRes.data as StudySession[]) ?? []);
      if (settingsRes.data) setSettings(settingsRes.data as UserSettings);
      if (topicsRes.data) {
        const seen = new Set<string>();
        const topics: string[] = [];
        for (const row of topicsRes.data as { topic: string }[]) {
          const t = row.topic.trim();
          if (t && !seen.has(t.toLowerCase())) {
            seen.add(t.toLowerCase());
            topics.push(t);
          }
        }
        setKnownTopics(topics);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, weekStartYmd, weekEndYmd]);

  async function handleQuickAdd(e: FormEvent) {
    e.preventDefault();
    if (!user || adding) return;
    const topic = addTopic.trim();
    const minutes = Math.round(Number(addMinutes));
    if (!topic) {
      setError("Topic is required.");
      return;
    }
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      setError("Minutes must be between 1 and 1440.");
      return;
    }
    setAdding(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("study_sessions")
      .insert({
        user_id: user.id,
        studied_on: addDate || ymd(),
        topic,
        minutes,
        notes: addNote.trim() ? addNote.trim() : null,
      })
      .select()
      .single();
    setAdding(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (data) {
      const row = data as StudySession;
      if (row.studied_on >= weekStartYmd && row.studied_on <= weekEndYmd) {
        setSessions((ss) =>
          [...ss, row].sort(
            (a, b) =>
              a.studied_on.localeCompare(b.studied_on) ||
              a.created_at.localeCompare(b.created_at)
          )
        );
      }
      setKnownTopics((ts) =>
        ts.some((t) => t.toLowerCase() === topic.toLowerCase()) ? ts : [topic, ...ts]
      );
      setAddTopic("");
      setAddMinutes("");
      setAddNote("");
    }
  }

  async function handleDelete(session: StudySession) {
    if (!confirm(`Delete ${formatMinutes(session.minutes)} of "${session.topic}"?`)) return;
    const prev = sessions;
    setSessions((ss) => ss.filter((s) => s.id !== session.id));
    const { error: err } = await supabase
      .from("study_sessions")
      .delete()
      .eq("id", session.id);
    if (err) {
      setSessions(prev);
      setError(err.message);
    }
  }

  async function saveTarget() {
    if (!user || savingTarget) return;
    const hours = Number(targetHours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 168) {
      setError("Weekly target must be 0–168 hours.");
      return;
    }
    setSavingTarget(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("user_settings")
      .upsert(
        { user_id: user.id, weekly_study_target_min: Math.round(hours * 60) },
        { onConflict: "user_id" }
      )
      .select()
      .single();
    setSavingTarget(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (data) setSettings(data as UserSettings);
    setEditingTarget(false);
  }

  const targetMin = settings?.weekly_study_target_min ?? 0;
  const totalMin = useMemo(
    () => sessions.reduce((s, x) => s + x.minutes, 0),
    [sessions]
  );

  /** Burn-up chart: cumulative minutes Mon..Sun vs flat target line. */
  const burnUp = useMemo(() => {
    const days = weekDates(weekStart);
    const today = ymd();
    const perDay = new Map<string, number>();
    for (const s of sessions) {
      perDay.set(s.studied_on, (perDay.get(s.studied_on) ?? 0) + s.minutes);
    }
    let cum = 0;
    return days.map((d, i) => {
      const key = ymd(d);
      cum += perDay.get(key) ?? 0;
      // Stop the studied line at today for the current week.
      const future = key > today;
      return {
        label: DAY_LABELS[i],
        studied: future ? null : cum,
        target: targetMin > 0 ? targetMin : null,
      };
    });
  }, [sessions, weekStart, targetMin]);

  /** Top 5 topics this week by total minutes. */
  const topTopics = useMemo(() => {
    const totals = new Map<string, number>();
    for (const s of sessions) {
      const key = s.topic.trim();
      totals.set(key, (totals.get(key) ?? 0) + s.minutes);
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [sessions]);

  /** Sessions grouped by day, newest day first. */
  const byDay = useMemo(() => {
    const map = new Map<string, StudySession[]>();
    for (const s of sessions) {
      const list = map.get(s.studied_on) ?? [];
      list.push(s);
      map.set(s.studied_on, list);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [sessions]);

  const isCurrentWeek = weekStartYmd === ymd(startOfWeek());
  const weekLabel = `${parseYmd(weekStartYmd).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })} – ${parseYmd(weekEndYmd).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Study Log"
        icon={<BookOpen className="h-5 w-5" />}
        description={
          totalMin === 0
            ? "Log study sessions and burn up to the weekly target."
            : `${formatMinutes(totalMin)} logged this week${
                targetMin > 0
                  ? ` · ${Math.min(100, Math.round((totalMin / targetMin) * 100))}% of target`
                  : ""
              }.`
        }
      />

      {/* Week switcher + weekly target */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="inline-flex items-center gap-1 rounded-md border bg-card p-0.5">
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            aria-label="Previous week"
            className="rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-2 text-sm font-medium tabular-nums">
            {isCurrentWeek ? "This week" : weekLabel}
          </span>
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            aria-label="Next week"
            className="rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {!isCurrentWeek && (
          <button
            type="button"
            onClick={() => setWeekStart(startOfWeek())}
            className="text-xs text-primary hover:underline text-left"
          >
            Back to this week
          </button>
        )}

        <div className="sm:ml-auto flex items-center gap-2 text-sm">
          <Target className="h-4 w-4 text-primary" />
          {editingTarget ? (
            <span className="inline-flex items-center gap-1.5">
              <Input
                type="number"
                min={0}
                max={168}
                step={0.5}
                inputMode="decimal"
                value={targetHours}
                onChange={(e) => setTargetHours(e.target.value)}
                className="h-8 w-20 text-sm"
                aria-label="Weekly target in hours"
                autoFocus
              />
              <span className="text-muted-foreground text-xs">h/week</span>
              <Button
                type="button"
                size="icon"
                className="h-8 w-8"
                onClick={() => void saveTarget()}
                disabled={savingTarget}
                aria-label="Save weekly target"
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => setEditingTarget(false)}
                disabled={savingTarget}
                aria-label="Cancel"
              >
                <X className="h-4 w-4" />
              </Button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setTargetHours(
                  targetMin > 0 ? String(Math.round((targetMin / 60) * 10) / 10) : ""
                );
                setEditingTarget(true);
              }}
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
            >
              Target:{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {targetMin > 0 ? `${Math.round((targetMin / 60) * 10) / 10}h` : "not set"}
              </span>
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* Quick-add row */}
      <Card>
        <CardContent className="p-4">
          <form
            onSubmit={handleQuickAdd}
            className="grid grid-cols-1 sm:grid-cols-[170px,1fr,110px,1fr,auto] gap-2 items-end"
          >
            <div className="space-y-1">
              <Label htmlFor="st-date" className="text-xs">
                Date
              </Label>
              <DateField id="st-date" value={addDate} onChange={setAddDate} quickPicks={false} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="st-topic" className="text-xs">
                Topic
              </Label>
              <Input
                id="st-topic"
                list="st-topic-options"
                value={addTopic}
                onChange={(e) => setAddTopic(e.target.value)}
                placeholder="e.g. Dynamic programming"
                maxLength={200}
                required
              />
              <datalist id="st-topic-options">
                {knownTopics.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label htmlFor="st-min" className="text-xs">
                Minutes
              </Label>
              <Input
                id="st-min"
                type="number"
                min={1}
                max={1440}
                step={5}
                inputMode="numeric"
                value={addMinutes}
                onChange={(e) => setAddMinutes(e.target.value)}
                placeholder="45"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="st-note" className="text-xs">
                Note (optional)
              </Label>
              <Input
                id="st-note"
                value={addNote}
                onChange={(e) => setAddNote(e.target.value)}
                placeholder="What did you cover?"
                maxLength={500}
              />
            </div>
            <Button type="submit" disabled={adding || !addTopic.trim() || !addMinutes}>
              <Plus className="h-4 w-4" /> {adding ? "Adding…" : "Add"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {loading ? (
        <SkeletonList rows={3} />
      ) : (
        <>
          {/* Burn-up chart */}
          <Card>
            <CardContent className="p-4 h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={burnUp} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={PREP_CHART_COLORS.slate}
                    strokeOpacity={0.2}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: PREP_CHART_COLORS.slate }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: PREP_CHART_COLORS.slate }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => formatMinutes(v)}
                    width={52}
                  />
                  <Tooltip
                    formatter={(v: number, name: string) => [
                      formatMinutes(v),
                      name === "studied" ? "Studied (cumulative)" : "Weekly target",
                    ]}
                    wrapperStyle={{ fontSize: "12px" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="studied"
                    stroke={PREP_CHART_COLORS.primary}
                    strokeWidth={2}
                    dot={{ r: 3, fill: PREP_CHART_COLORS.primary, strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                  {targetMin > 0 && (
                    <Line
                      type="monotone"
                      dataKey="target"
                      stroke={PREP_CHART_COLORS.slate}
                      strokeWidth={1.5}
                      strokeDasharray="6 4"
                      dot={false}
                      activeDot={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Top topics this week */}
          {topTopics.length > 0 && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Top topics this week
                </h3>
                {topTopics.map(([topic, min], i) => {
                  const max = topTopics[0][1];
                  const pct = max === 0 ? 0 : (min / max) * 100;
                  const color = TOPIC_BAR_COLORS[i % TOPIC_BAR_COLORS.length];
                  return (
                    <div key={topic} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate">{topic}</span>
                        <span className="text-muted-foreground tabular-nums text-xs">
                          {formatMinutes(min)}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Sessions grouped by day */}
          {sessions.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="h-7 w-7" />}
              title={isCurrentWeek ? "Nothing logged this week yet" : "Nothing logged this week"}
              description="Use the quick-add row above to log a study session in seconds."
            />
          ) : (
            <div className="space-y-4">
              {byDay.map(([day, list]) => {
                const dayTotal = list.reduce((s, x) => s + x.minutes, 0);
                return (
                  <div key={day}>
                    <div className="flex items-baseline justify-between mb-2 px-1">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {parseYmd(day).toLocaleDateString([], {
                          weekday: "long",
                          month: "short",
                          day: "numeric",
                        })}
                        {day === ymd() && " · Today"}
                      </h3>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {formatMinutes(dayTotal)}
                      </span>
                    </div>
                    <Card>
                      <CardContent className="p-0">
                        <ul className="divide-y">
                          {list
                            .slice()
                            .sort((a, b) => b.created_at.localeCompare(a.created_at))
                            .map((s) => (
                              <li
                                key={s.id}
                                className="group flex items-center gap-3 px-4 py-2.5 text-sm"
                              >
                                <span className="font-medium truncate">{s.topic}</span>
                                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                                  {formatMinutes(s.minutes)}
                                </span>
                                {s.notes && (
                                  <span className="text-xs text-muted-foreground truncate">
                                    — {s.notes}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => void handleDelete(s)}
                                  aria-label={`Delete ${s.topic} session`}
                                  className={cn(
                                    "ml-auto shrink-0 rounded-md p-1.5 text-muted-foreground",
                                    "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity",
                                    "hover:bg-destructive/10 hover:text-destructive"
                                  )}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </li>
                            ))}
                        </ul>
                      </CardContent>
                    </Card>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
