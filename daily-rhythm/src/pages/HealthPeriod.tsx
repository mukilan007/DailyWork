import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  Heart,
  Calendar,
  Droplets,
  CalendarHeart,
  CalendarClock,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Dialog } from "@/components/ui/Dialog";
import { DateField } from "@/components/ui/DateField";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { ExportButton } from "@/components/ui/ExportButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonStatGrid, SkeletonCard } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import type { PeriodLog } from "@/types";
import { ymd, formatDate } from "@/lib/dates";
import { exportReport } from "@/lib/export";
import { cn } from "@/lib/utils";

const SYMPTOM_OPTIONS = ["Cramps", "Headache", "Bloating", "Fatigue", "Acne", "Tender breasts", "Backache", "Nausea"] as const;
const MOOD_OPTIONS = ["Happy", "Calm", "Anxious", "Sad", "Irritable", "Energetic", "Tired"] as const;

export function HealthPeriodPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<PeriodLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<PeriodLog | null>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  /** Set when the user clicks an empty calendar cell — pre-fills Add dialog. */
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("period_logs")
        .select("*")
        .order("log_date", { ascending: false })
        .limit(180);
      if (cancelled) return;
      if (error) setError(error.message);
      else setLogs(data ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Cycle insights: average length between first-day-of-period entries.
  const insights = useMemo(() => computeCycleInsights(logs), [logs]);

  // Fast lookup for calendar rendering.
  const logByDate = useMemo(() => {
    const m = new Map<string, PeriodLog>();
    for (const l of logs) m.set(l.log_date, l);
    return m;
  }, [logs]);

  async function deleteLog(log: PeriodLog) {
    if (!confirm(`Delete log for ${formatDate(log.log_date)}?`)) return;
    const prev = logs;
    setLogs((l) => l.filter((x) => x.id !== log.id));
    const { error } = await supabase.from("period_logs").delete().eq("id", log.id);
    if (error) {
      setLogs(prev);
      setError(error.message);
    }
  }

  /** Bulk-mark every day in [startDate, endDate] as a period day with the given flow.
   * Existing symptoms / mood / notes on those days are preserved. */
  async function handleSaveRange(
    startDate: string,
    endDate: string,
    flow: PeriodLog["flow"]
  ) {
    if (!user) return;
    const dates: string[] = [];
    const cur = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    while (cur.getTime() <= end.getTime()) {
      dates.push(ymd(cur));
      cur.setDate(cur.getDate() + 1);
    }
    const payload = dates.map((d) => {
      const existing = logByDate.get(d);
      return {
        user_id: user.id,
        log_date: d,
        is_period: true,
        flow,
        symptoms: existing?.symptoms ?? [],
        mood: existing?.mood ?? null,
        notes: existing?.notes ?? null,
      };
    });
    const { data, error } = await supabase
      .from("period_logs")
      .upsert(payload, { onConflict: "user_id,log_date" })
      .select();
    if (error) {
      setError(error.message);
      return;
    }
    if (data) {
      setLogs((prev) => {
        const dataDates = new Set(data.map((l) => l.log_date));
        const without = prev.filter((l) => !dataDates.has(l.log_date));
        return [...data, ...without].sort((a, b) => (a.log_date < b.log_date ? 1 : -1));
      });
    }
    setRangeOpen(false);
  }

  async function handleSave(input: Omit<PeriodLog, "id" | "user_id">) {
    if (!user) return;
    // Upsert because (user_id, log_date) is unique — re-logging the same day updates it.
    const { data, error } = await supabase
      .from("period_logs")
      .upsert({ user_id: user.id, ...input }, { onConflict: "user_id,log_date" })
      .select()
      .single();
    if (error || !data) {
      setError(error?.message ?? "Save failed");
      return;
    }
    setLogs((prev) => {
      const without = prev.filter((l) => l.log_date !== data.log_date);
      return [data, ...without].sort((a, b) => (a.log_date < b.log_date ? 1 : -1));
    });
    setAddOpen(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Period Tracker"
        icon={<Heart className="h-5 w-5" />}
        description="Track your cycle, symptoms, and mood."
        actions={
          <div className="flex items-center gap-2">
            <ExportButton
              disabled={loading || logs.length === 0}
              onExport={(format) =>
                exportReport({
                  name: "period-logs",
                  format,
                  rows: logs.map((l) => ({
                    log_date: l.log_date,
                    is_period: l.is_period,
                    flow: l.flow ?? "",
                    symptoms: l.symptoms ?? [],
                    mood: l.mood ?? "",
                    notes: l.notes ?? "",
                    id: l.id,
                  })),
                  columns: ["log_date", "is_period", "flow", "symptoms", "mood", "notes", "id"],
                  meta: { source: "period", insights },
                })
              }
            />
            <Button variant="outline" onClick={() => setRangeOpen(true)} disabled={loading}>
              <CalendarRange className="h-4 w-4" /> Log Range
            </Button>
            <Button onClick={() => setAddOpen(true)} disabled={loading}>
              <Plus className="h-4 w-4" /> Add Log
            </Button>
          </div>
        }
      />

      {error && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <SkeletonStatGrid count={3} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <InsightCard
            accent="rose"
            icon={<Droplets className="h-4 w-4" />}
            label="Last period"
            value={insights.lastPeriodStart ? formatDate(insights.lastPeriodStart) : "—"}
            hint={insights.lastPeriodStart ? undefined : "Mark a day as 'On my period'"}
          />
          <InsightCard
            accent="indigo"
            icon={<CalendarHeart className="h-4 w-4" />}
            label="Avg cycle"
            value={insights.avgCycleDays != null ? `${insights.avgCycleDays} days` : "—"}
            hint={
              insights.avgCycleDays != null
                ? undefined
                : insights.lastPeriodStart
                ? "Log another period to compute"
                : "Needs 2+ periods"
            }
          />
          <InsightCard
            accent="primary"
            icon={<CalendarClock className="h-4 w-4" />}
            label="Predicted next"
            value={insights.predictedNext ? formatDate(insights.predictedNext) : "—"}
            hint={
              insights.predictedNext
                ? insights.predictionIsEstimate
                  ? `Estimate (assumes ${DEFAULT_CYCLE_DAYS}-day cycle)`
                  : undefined
                : "Mark a period start to predict"
            }
          />
        </div>
      )}

      {!loading && (
        <CycleCalendar
          month={calendarMonth}
          onPrev={() => setCalendarMonth(shiftMonth(calendarMonth, -1))}
          onNext={() => setCalendarMonth(shiftMonth(calendarMonth, 1))}
          onToday={() => {
            const d = new Date();
            d.setDate(1);
            d.setHours(0, 0, 0, 0);
            setCalendarMonth(d);
          }}
          logByDate={logByDate}
          predictedNext={insights.predictedNext}
          onPickDate={(dateKey) => {
            const existing = logByDate.get(dateKey);
            if (existing) {
              setEditing(existing);
            } else {
              setPickedDate(dateKey);
              setAddOpen(true);
            }
          }}
        />
      )}

      {loading ? (
        <SkeletonCard rows={4} />
      ) : logs.length === 0 ? (
        <EmptyState
          icon={<Heart className="h-7 w-7" />}
          title="No logs yet"
          description="Track your cycle by logging period days, symptoms, and mood. Insights appear after a few entries."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Add your first log
            </Button>
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-4 w-4 text-primary" /> Recent logs
            </CardTitle>
            <CardDescription>Most recent first.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border -mt-2">
              {logs.slice(0, 30).map((log) => (
                <li key={log.id} className="py-3 flex items-start justify-between gap-3 hover:bg-accent/30 -mx-3 px-3 rounded transition-colors">
                  <div className="min-w-0 space-y-1.5 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{formatDate(log.log_date)}</span>
                      {log.is_period && (
                        <Badge variant="destructive" className="capitalize">
                          <Droplets className="h-3 w-3" />
                          Period{log.flow ? ` · ${log.flow}` : ""}
                        </Badge>
                      )}
                      {log.mood && (
                        <Badge variant="secondary">{moodEmoji(log.mood)} {log.mood}</Badge>
                      )}
                    </div>
                    {log.symptoms.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {log.symptoms.map((s) => (
                          <span
                            key={s}
                            className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                    {log.notes && (
                      <p className="text-xs text-muted-foreground italic border-l-2 border-primary/30 pl-2">
                        {log.notes}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-60 hover:opacity-100"
                      aria-label={`Edit log for ${formatDate(log.log_date)}`}
                      onClick={() => setEditing(log)}
                    >
                      <Pencil className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-60 hover:opacity-100 hover:text-destructive"
                      aria-label={`Delete log for ${formatDate(log.log_date)}`}
                      onClick={() => deleteLog(log)}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <PeriodLogDialog
        open={addOpen || editing !== null}
        initial={editing}
        defaultDate={pickedDate}
        onClose={() => {
          setAddOpen(false);
          setEditing(null);
          setPickedDate(null);
        }}
        onSave={handleSave}
      />

      <PeriodRangeDialog
        open={rangeOpen}
        onClose={() => setRangeOpen(false)}
        onSave={handleSaveRange}
      />
    </div>
  );
}

function PeriodLogDialog({
  open,
  initial,
  defaultDate,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: PeriodLog | null;
  /** Pre-filled date for Add mode (e.g. when clicking a calendar cell). */
  defaultDate?: string | null;
  onClose: () => void;
  onSave: (input: Omit<PeriodLog, "id" | "user_id">) => Promise<void>;
}) {
  const [logDate, setLogDate] = useState(ymd());
  const [isPeriod, setIsPeriod] = useState(false);
  const [flow, setFlow] = useState<PeriodLog["flow"]>(null);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [mood, setMood] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Sync form state with `initial` whenever the dialog opens. Reset when closed.
  useEffect(() => {
    if (!open) {
      setSaving(false);
      return;
    }
    if (initial) {
      setLogDate(initial.log_date);
      setIsPeriod(initial.is_period);
      setFlow(initial.flow);
      setSymptoms(initial.symptoms ?? []);
      setMood(initial.mood ?? "");
      setNotes(initial.notes ?? "");
    } else {
      setLogDate(defaultDate ?? ymd());
      setIsPeriod(false);
      setFlow(null);
      setSymptoms([]);
      setMood("");
      setNotes("");
    }
  }, [open, initial, defaultDate]);

  function toggleSymptom(s: string) {
    setSymptoms((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({
      log_date: logDate,
      is_period: isPeriod,
      flow: isPeriod ? flow : null,
      symptoms,
      mood: mood || null,
      notes: notes.trim() || null,
    });
    setSaving(false);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? "Edit log" : "Log day"}
      description={initial ? "Update symptoms, flow, or notes for this day." : "Track your symptoms and mood."}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="p-date">Date</Label>
          <DateField
            id="p-date"
            value={logDate}
            onChange={setLogDate}
            required
            disabled={!!initial}
          />
          {initial && (
            <p className="text-[11px] text-muted-foreground">
              Date can&rsquo;t be changed when editing an existing log.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPeriod}
              onChange={(e) => setIsPeriod(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            On my period today
          </label>
          {isPeriod && (
            <Select value={flow ?? ""} onChange={(e) => setFlow((e.target.value || null) as PeriodLog["flow"])}>
              <option value="">Flow…</option>
              <option value="light">Light</option>
              <option value="medium">Medium</option>
              <option value="heavy">Heavy</option>
            </Select>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Symptoms</Label>
          <div className="flex flex-wrap gap-2">
            {SYMPTOM_OPTIONS.map((s) => {
              const active = symptoms.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSymptom(s)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-input hover:bg-accent"
                  }`}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="p-mood">Mood</Label>
          <Select id="p-mood" value={mood} onChange={(e) => setMood(e.target.value)}>
            <option value="">None</option>
            {MOOD_OPTIONS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="p-notes">Notes</Label>
          <Textarea id="p-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : initial ? "Save changes" : "Save log"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const INSIGHT_ACCENTS = {
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/20",
  indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-indigo-500/20",
  primary: "bg-primary/10 text-primary ring-primary/20",
} as const;

function InsightCard({
  accent,
  icon,
  label,
  value,
  hint,
}: {
  accent: keyof typeof INSIGHT_ACCENTS;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-inset",
              INSIGHT_ACCENTS[accent]
            )}
          >
            {icon}
          </div>
        </div>
        <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Cycle calendar                                                      */
/* ------------------------------------------------------------------ */

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function shiftMonth(d: Date, delta: number): Date {
  const next = new Date(d);
  next.setMonth(next.getMonth() + delta);
  next.setDate(1);
  next.setHours(0, 0, 0, 0);
  return next;
}

function CycleCalendar({
  month,
  onPrev,
  onNext,
  onToday,
  logByDate,
  predictedNext,
  onPickDate,
}: {
  month: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  logByDate: Map<string, PeriodLog>;
  predictedNext: string | null;
  onPickDate: (dateKey: string) => void;
}) {
  const todayKey = ymd();

  // Build a 6×7 grid starting from the Sunday on/before the 1st.
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(start.getDate() - first.getDay());
    const out: { date: Date; key: string; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push({
        date: d,
        key: ymd(d),
        inMonth: d.getMonth() === month.getMonth(),
      });
    }
    return out;
  }, [month]);

  const monthLabel = month.toLocaleDateString([], { month: "long", year: "numeric" });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-4 w-4 text-primary" /> Cycle Calendar
            </CardTitle>
            <CardDescription>
              Tap a day to log it. Color shows what happened that day.
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Previous month" onClick={onPrev} className="h-8 w-8">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[8rem] text-center text-sm font-medium tabular-nums">
              {monthLabel}
            </span>
            <Button variant="ghost" size="icon" aria-label="Next month" onClick={onNext} className="h-8 w-8">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={onToday} className="ml-1 h-8">
              Today
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAY_LABELS.map((d) => (
            <div
              key={d}
              className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground py-1"
            >
              {d}
            </div>
          ))}
          {cells.map(({ date, key, inMonth }) => {
            const log = logByDate.get(key);
            const isPeriod = !!log?.is_period;
            const hasSymptoms = !!log && !log.is_period && log.symptoms.length > 0;
            const isToday = key === todayKey;
            const isPredicted = key === predictedNext;
            const flow = log?.flow;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onPickDate(key)}
                aria-label={`${formatDate(key)}${isPeriod ? " — period" : hasSymptoms ? " — symptoms" : ""}`}
                aria-pressed={isPeriod || hasSymptoms}
                className={cn(
                  "relative aspect-square rounded-md flex flex-col items-center justify-center gap-0.5 text-xs transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                  !inMonth && "opacity-40",
                  isPeriod
                    ? cn(
                        "text-rose-700 dark:text-rose-200 font-semibold ring-1 ring-inset ring-rose-500/30",
                        flow === "heavy"
                          ? "bg-rose-500/30 hover:bg-rose-500/40"
                          : flow === "medium"
                          ? "bg-rose-500/20 hover:bg-rose-500/30"
                          : "bg-rose-500/15 hover:bg-rose-500/25"
                      )
                    : hasSymptoms
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/30 hover:bg-emerald-500/25"
                    : isPredicted
                    ? "bg-transparent text-foreground border border-dashed border-primary/60 hover:bg-primary/5"
                    : "bg-muted/30 text-foreground hover:bg-muted",
                  isToday && "ring-2 ring-primary"
                )}
              >
                <span className="tabular-nums leading-none">{date.getDate()}</span>
                {(isPeriod || hasSymptoms) && (
                  <span
                    aria-hidden
                    className={cn(
                      "h-1 w-1 rounded-full",
                      isPeriod ? "bg-rose-500" : "bg-emerald-500"
                    )}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
          <LegendSwatch className="bg-rose-500/25 ring-1 ring-inset ring-rose-500/30" label="Period" />
          <LegendSwatch className="bg-emerald-500/20 ring-1 ring-inset ring-emerald-500/30" label="Symptoms" />
          <LegendSwatch className="border border-dashed border-primary/60 bg-transparent" label="Predicted" />
          <LegendSwatch className="bg-muted/30 ring-2 ring-primary" label="Today" />
        </div>
      </CardContent>
    </Card>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-3 w-3 rounded-sm", className)} />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Period range dialog                                                 */
/* ------------------------------------------------------------------ */

function PeriodRangeDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (startDate: string, endDate: string, flow: PeriodLog["flow"]) => Promise<void>;
}) {
  const [startDate, setStartDate] = useState(ymd());
  const [endDate, setEndDate] = useState(ymd());
  const [flow, setFlow] = useState<PeriodLog["flow"]>("medium");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setSaving(false);
      return;
    }
    const today = ymd();
    setStartDate(today);
    setEndDate(today);
    setFlow("medium");
  }, [open]);

  // Range validity & day count.
  const dayCount = useMemo(() => {
    if (!startDate || !endDate) return 0;
    if (startDate > endDate) return 0;
    const a = new Date(`${startDate}T00:00:00`).getTime();
    const b = new Date(`${endDate}T00:00:00`).getTime();
    return Math.round((b - a) / 86_400_000) + 1;
  }, [startDate, endDate]);

  const tooLong = dayCount > 14;
  const invalid = dayCount === 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (invalid || tooLong) return;
    setSaving(true);
    await onSave(startDate, endDate, flow);
    setSaving(false);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Log period range"
      description="Mark every day in the range as a period day. Existing notes and symptoms on those days are kept."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pr-start">Start</Label>
            <DateField
              id="pr-start"
              value={startDate}
              onChange={(next) => {
                setStartDate(next);
                // Keep range coherent: nudge end if it falls before start.
                if (endDate && next > endDate) setEndDate(next);
              }}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-end">End</Label>
            <DateField
              id="pr-end"
              value={endDate}
              onChange={setEndDate}
              min={startDate}
              required
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pr-flow">Flow</Label>
          <Select
            id="pr-flow"
            value={flow ?? ""}
            onChange={(e) => setFlow((e.target.value || null) as PeriodLog["flow"])}
          >
            <option value="">Unspecified</option>
            <option value="light">Light</option>
            <option value="medium">Medium</option>
            <option value="heavy">Heavy</option>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Applied to every day in the range. You can fine-tune individual days afterwards.
          </p>
        </div>

        <div
          className={cn(
            "rounded-md border p-3 text-xs",
            invalid
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : tooLong
              ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              : "border-border bg-muted/30 text-muted-foreground"
          )}
        >
          {invalid
            ? "End date must be on or after the start date."
            : tooLong
            ? `That's ${dayCount} days — periods this long are unusual. Double-check the range before saving.`
            : `Will mark ${dayCount} day${dayCount === 1 ? "" : "s"} as period.`}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || invalid}>
            {saving ? "Saving…" : `Mark ${dayCount || ""} day${dayCount === 1 ? "" : "s"}`.trim()}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function moodEmoji(mood: string): string {
  const m = mood.toLowerCase();
  if (m === "happy") return "😊";
  if (m === "calm") return "😌";
  if (m === "anxious") return "😰";
  if (m === "sad") return "😢";
  if (m === "irritable") return "😤";
  if (m === "energetic") return "⚡";
  if (m === "tired") return "😴";
  return "•";
}

const DEFAULT_CYCLE_DAYS = 28;

function computeCycleInsights(logs: PeriodLog[]): {
  lastPeriodStart: string | null;
  avgCycleDays: number | null;
  predictedNext: string | null;
  predictionIsEstimate: boolean;
} {
  // Detect first-day-of-period: an `is_period` log whose previous day was not a period.
  const periodDates = logs
    .filter((l) => l.is_period)
    .map((l) => l.log_date)
    .sort(); // ascending YYYY-MM-DD sorts lex == chrono
  const periodSet = new Set(periodDates);
  const firstDays: string[] = [];
  for (const d of periodDates) {
    const prev = new Date(d);
    prev.setDate(prev.getDate() - 1);
    if (!periodSet.has(ymd(prev))) firstDays.push(d);
  }
  if (firstDays.length === 0) {
    return { lastPeriodStart: null, avgCycleDays: null, predictedNext: null, predictionIsEstimate: false };
  }
  const lastPeriodStart = firstDays[firstDays.length - 1];

  // With only one logged period start we can't compute a real average, but
  // we can still show a useful prediction using a 28-day default.
  if (firstDays.length < 2) {
    const next = new Date(lastPeriodStart);
    next.setDate(next.getDate() + DEFAULT_CYCLE_DAYS);
    return {
      lastPeriodStart,
      avgCycleDays: null,
      predictedNext: ymd(next),
      predictionIsEstimate: true,
    };
  }

  const diffs: number[] = [];
  for (let i = 1; i < firstDays.length; i++) {
    const a = new Date(firstDays[i - 1]);
    const b = new Date(firstDays[i]);
    diffs.push(Math.round((b.getTime() - a.getTime()) / 86_400_000));
  }
  const avg = Math.round(diffs.reduce((s, n) => s + n, 0) / diffs.length);
  const next = new Date(lastPeriodStart);
  next.setDate(next.getDate() + avg);
  return { lastPeriodStart, avgCycleDays: avg, predictedNext: ymd(next), predictionIsEstimate: false };
}
