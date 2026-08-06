import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceLine,
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
import { Dialog } from "@/components/ui/Dialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { addDays, DAY_LABELS, parseYmd, startOfWeek, ymd } from "@/lib/dates";
import {
  formatMinutes,
  PREP_CHART_COLORS,
  TOPIC_BAR_COLORS,
} from "@/lib/prep";
import type { StudySession, UserSettings } from "@/types";
import { cn } from "@/lib/utils";

type StudyPeriod = "day" | "week" | "month" | "year";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Inclusive [start, end] Date bounds for the given period around `anchor`. */
function periodBounds(mode: StudyPeriod, anchor: Date): { start: Date; end: Date } {
  if (mode === "day") {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    return { start, end: start };
  }
  if (mode === "week") {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 6) };
  }
  if (mode === "month") {
    return {
      start: new Date(anchor.getFullYear(), anchor.getMonth(), 1),
      end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0),
    };
  }
  return {
    start: new Date(anchor.getFullYear(), 0, 1),
    end: new Date(anchor.getFullYear(), 11, 31),
  };
}

export function PrepStudyPage() {
  const { user } = useAuth();
  const [periodMode, setPeriodMode] = useState<StudyPeriod>("week");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
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

  // Edit-session dialog
  const [editing, setEditing] = useState<StudySession | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTopic, setEditTopic] = useState("");
  const [editMinutes, setEditMinutes] = useState("");
  const [editNote, setEditNote] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Weekly target inline editing
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetHours, setTargetHours] = useState("");
  const [savingTarget, setSavingTarget] = useState(false);

  const bounds = useMemo(() => periodBounds(periodMode, anchor), [periodMode, anchor]);
  const rangeStartYmd = ymd(bounds.start);
  const rangeEndYmd = ymd(bounds.end);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [sessRes, settingsRes, topicsRes] = await Promise.all([
        supabase
          .from("study_sessions")
          .select("*")
          .gte("studied_on", rangeStartYmd)
          .lte("studied_on", rangeEndYmd)
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
  }, [user, rangeStartYmd, rangeEndYmd]);

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
      if (row.studied_on >= rangeStartYmd && row.studied_on <= rangeEndYmd) {
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

  function openEdit(s: StudySession) {
    setError(null);
    setEditing(s);
    setEditDate(s.studied_on);
    setEditTopic(s.topic);
    setEditMinutes(String(s.minutes));
    setEditNote(s.notes ?? "");
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing || savingEdit) return;
    const topic = editTopic.trim();
    const minutes = Math.round(Number(editMinutes));
    if (!topic) {
      setError("Topic is required.");
      return;
    }
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      setError("Minutes must be between 1 and 1440.");
      return;
    }
    setSavingEdit(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("study_sessions")
      .update({
        studied_on: editDate || editing.studied_on,
        topic,
        minutes,
        notes: editNote.trim() ? editNote.trim() : null,
      })
      .eq("id", editing.id)
      .select()
      .single();
    setSavingEdit(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (data) {
      const row = data as StudySession;
      setSessions((ss) => {
        const rest = ss.filter((x) => x.id !== row.id);
        // Keep it visible only if it still falls in the selected period.
        if (row.studied_on >= rangeStartYmd && row.studied_on <= rangeEndYmd) {
          return [...rest, row].sort(
            (a, b) =>
              a.studied_on.localeCompare(b.studied_on) ||
              a.created_at.localeCompare(b.created_at)
          );
        }
        return rest;
      });
      setKnownTopics((ts) =>
        ts.some((t) => t.toLowerCase() === topic.toLowerCase()) ? ts : [topic, ...ts]
      );
    }
    setEditing(null);
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

  // The stored target is weekly; scale it to the selected period for the goal.
  const targetMin = settings?.weekly_study_target_min ?? 0;
  const periodDayCount =
    Math.round((bounds.end.getTime() - bounds.start.getTime()) / 86_400_000) + 1;
  const periodTargetMin =
    targetMin > 0 ? Math.round((targetMin * periodDayCount) / 7) : 0;

  const totalMin = useMemo(
    () => sessions.reduce((s, x) => s + x.minutes, 0),
    [sessions]
  );

  /** Per-bucket study minutes — each bar is that bucket's OWN total, not a
   *  running cumulative. Week → per weekday, Month → per day-of-month,
   *  Year → per month, Day → per session. */
  const chartData = useMemo(() => {
    if (periodMode === "year") {
      const perMonth = new Array(12).fill(0);
      for (const s of sessions) {
        perMonth[parseYmd(s.studied_on).getMonth()] += s.minutes;
      }
      return perMonth.map((minutes, m) => ({ label: MONTHS_SHORT[m], minutes }));
    }
    if (periodMode === "day") {
      const dayKey = ymd(bounds.start);
      return sessions
        .filter((s) => s.studied_on === dayKey)
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((s) => ({
          label: new Date(s.created_at).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
          minutes: s.minutes,
        }));
    }
    const perDay = new Map<string, number>();
    for (const s of sessions) {
      perDay.set(s.studied_on, (perDay.get(s.studied_on) ?? 0) + s.minutes);
    }
    const points: Array<{ label: string; minutes: number }> = [];
    for (let i = 0; i < periodDayCount; i++) {
      const d = addDays(bounds.start, i);
      points.push({
        label: periodMode === "week" ? DAY_LABELS[i] : String(d.getDate()),
        minutes: perDay.get(ymd(d)) ?? 0,
      });
    }
    return points;
  }, [sessions, periodMode, bounds, periodDayCount]);

  // Per-bucket reference target: daily for day/week/month, monthly for year.
  const perBucketTargetMin =
    targetMin > 0
      ? periodMode === "year"
        ? Math.round((targetMin * 52) / 12)
        : Math.round(targetMin / 7)
      : 0;

  // Thin out X-axis labels on the busier month view.
  const xTickInterval = periodMode === "month" ? 2 : 0;

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

  const now = new Date();
  const isCurrent =
    periodMode === "day"
      ? rangeStartYmd === ymd(now)
      : periodMode === "week"
      ? rangeStartYmd === ymd(startOfWeek(now))
      : periodMode === "month"
      ? anchor.getFullYear() === now.getFullYear() &&
        anchor.getMonth() === now.getMonth()
      : anchor.getFullYear() === now.getFullYear();

  const periodLabel =
    periodMode === "day"
      ? isCurrent
        ? "Today"
        : anchor.toLocaleDateString([], {
            weekday: "short",
            month: "short",
            day: "numeric",
          })
      : isCurrent
      ? `This ${periodMode}`
      : periodMode === "week"
      ? `${parseYmd(rangeStartYmd).toLocaleDateString([], {
          month: "short",
          day: "numeric",
        })} – ${parseYmd(rangeEndYmd).toLocaleDateString([], {
          month: "short",
          day: "numeric",
        })}`
      : periodMode === "month"
      ? anchor.toLocaleDateString([], { month: "long", year: "numeric" })
      : String(anchor.getFullYear());

  function shiftPeriod(dir: -1 | 1) {
    setAnchor((a) => {
      if (periodMode === "day") return addDays(a, dir);
      if (periodMode === "week") return addDays(a, dir * 7);
      if (periodMode === "month") return new Date(a.getFullYear(), a.getMonth() + dir, 1);
      return new Date(a.getFullYear() + dir, a.getMonth(), 1);
    });
  }

  // Day-mode: clicking the label opens a native date picker to jump directly.
  const dayInputRef = useRef<HTMLInputElement>(null);
  function openDayPicker() {
    const el = dayInputRef.current;
    if (!el) return;
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker();
        return;
      } catch {
        /* not user-initiated in some browsers — fall through to focus */
      }
    }
    el.focus();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Study Log"
        icon={<BookOpen className="h-5 w-5" />}
        description={
          totalMin === 0
            ? "Log study sessions and burn up to your target."
            : `${formatMinutes(totalMin)} logged this ${periodMode}${
                periodTargetMin > 0
                  ? ` · ${Math.min(
                      100,
                      Math.round((totalMin / periodTargetMin) * 100)
                    )}% of target`
                  : ""
              }.`
        }
      />

      {/* Period mode toggle + navigation + weekly target */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Week / Month / Year toggle */}
        <div className="inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5">
          {(["day", "week", "month", "year"] as StudyPeriod[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setPeriodMode(m)}
              aria-pressed={periodMode === m}
              className={cn(
                "rounded-sm px-3 py-1 text-xs font-medium capitalize transition-colors",
                periodMode === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="inline-flex items-center gap-1 rounded-md border bg-card p-0.5">
          <button
            type="button"
            onClick={() => shiftPeriod(-1)}
            aria-label={`Previous ${periodMode}`}
            className="rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {periodMode === "day" ? (
            <div className="relative">
              <button
                type="button"
                onClick={openDayPicker}
                className="px-2 text-sm font-medium tabular-nums min-w-[7rem] text-center hover:text-primary transition-colors"
                title="Pick a date"
              >
                {periodLabel}
              </button>
              <input
                ref={dayInputRef}
                type="date"
                value={rangeStartYmd}
                onChange={(e) => {
                  if (e.target.value) setAnchor(parseYmd(e.target.value));
                }}
                aria-label="Pick a date"
                tabIndex={-1}
                className="sr-only"
              />
            </div>
          ) : (
            <span className="px-2 text-sm font-medium tabular-nums min-w-[7rem] text-center">
              {periodLabel}
            </span>
          )}
          <button
            type="button"
            onClick={() => shiftPeriod(1)}
            aria-label={`Next ${periodMode}`}
            className="rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {!isCurrent && (
          <button
            type="button"
            onClick={() => setAnchor(new Date())}
            className="text-xs text-primary hover:underline text-left"
          >
            {periodMode === "day" ? "Back to today" : `Back to this ${periodMode}`}
          </button>
        )}

        {/* Total time logged for the selected period. */}
        <span className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-sm">
          <span className="text-muted-foreground">Total</span>
          <span className="font-semibold tabular-nums">
            {formatMinutes(totalMin)}
          </span>
        </span>

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
                <BarChart data={chartData} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={PREP_CHART_COLORS.slate}
                    strokeOpacity={0.2}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    interval={xTickInterval}
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
                    cursor={{ fill: PREP_CHART_COLORS.slate, fillOpacity: 0.1 }}
                    formatter={(v: number) => [formatMinutes(v), "Studied"]}
                    wrapperStyle={{ fontSize: "12px" }}
                  />
                  {perBucketTargetMin > 0 && (
                    <ReferenceLine
                      y={perBucketTargetMin}
                      stroke={PREP_CHART_COLORS.slate}
                      strokeDasharray="6 4"
                    />
                  )}
                  <Bar
                    dataKey="minutes"
                    fill={PREP_CHART_COLORS.primary}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={44}
                  >
                    <LabelList
                      dataKey="minutes"
                      position="top"
                      formatter={(v: number) => (v > 0 ? formatMinutes(v) : "")}
                      style={{ fontSize: 10, fill: "currentColor" }}
                      className="fill-foreground"
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Top topics this week */}
          {topTopics.length > 0 && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Top topics this {periodMode}
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
              title={`Nothing logged this ${periodMode}${isCurrent ? " yet" : ""}`}
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
                                <div className="ml-auto shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                  <button
                                    type="button"
                                    onClick={() => openEdit(s)}
                                    aria-label={`Edit ${s.topic} session`}
                                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDelete(s)}
                                    aria-label={`Delete ${s.topic} session`}
                                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
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

      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit study session"
      >
        <form onSubmit={saveEdit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ed-date" className="text-xs">
                Date
              </Label>
              <DateField
                id="ed-date"
                value={editDate}
                onChange={setEditDate}
                quickPicks={false}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ed-min" className="text-xs">
                Minutes
              </Label>
              <Input
                id="ed-min"
                type="number"
                min={1}
                max={1440}
                inputMode="numeric"
                value={editMinutes}
                onChange={(e) => setEditMinutes(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ed-topic" className="text-xs">
              Topic
            </Label>
            <Input
              id="ed-topic"
              list="st-topic-options"
              value={editTopic}
              onChange={(e) => setEditTopic(e.target.value)}
              maxLength={200}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ed-note" className="text-xs">
              Note (optional)
            </Label>
            <Input
              id="ed-note"
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              maxLength={500}
              placeholder="What did you cover?"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(null)}
              disabled={savingEdit}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={savingEdit || !editTopic.trim() || !editMinutes}
            >
              {savingEdit ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
