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
import { ConfirmDialog, type ConfirmAction } from "@/components/ui/ConfirmDialog";
import { DateField } from "@/components/ui/DateField";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { ExportButton } from "@/components/ui/ExportButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonStatGrid, SkeletonCard } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import type { PeriodLog } from "@/types";
import { ymd, formatDate, addDays } from "@/lib/dates";
import { exportReport } from "@/lib/export";
import { cn } from "@/lib/utils";

const SYMPTOM_OPTIONS = ["Cramps", "Headache", "Bloating", "Fatigue", "Acne", "Tender breasts", "Backache", "Nausea"] as const;
const MOOD_OPTIONS = ["Happy", "Calm", "Anxious", "Sad", "Irritable", "Energetic", "Tired"] as const;

type Flow = NonNullable<PeriodLog["flow"]>;

/** Single source of truth for how each flow level is presented across the
 *  page — calendar cell letter, run-bar shades, and recent-logs chip. Keeping
 *  this in one place prevents the L/M/H intensities from drifting apart. */
const FLOW_META: Record<Flow, {
  letter: "L" | "M" | "H";
  label: string;
  /** Calendar-cell letter color. */
  letterText: string;
  /** Inline chip in the Recent Logs list. */
  chip: string;
  /** RunBar middle (between start- and end-caps). */
  barMid: string;
  /** RunBar start/end caps (darker so the timeline reads). */
  barCap: string;
}> = {
  light: {
    letter: "L",
    label: "Light",
    letterText: "text-rose-500 dark:text-rose-300",
    chip: "bg-rose-500/10 text-rose-500 dark:text-rose-300 ring-rose-500/20",
    barMid: "bg-rose-500/15",
    barCap: "bg-rose-500/30",
  },
  medium: {
    letter: "M",
    label: "Medium",
    letterText: "text-rose-600 dark:text-rose-300",
    chip: "bg-rose-500/15 text-rose-600 dark:text-rose-300 ring-rose-500/30",
    barMid: "bg-rose-500/25",
    barCap: "bg-rose-500/45",
  },
  heavy: {
    letter: "H",
    label: "Heavy",
    letterText: "text-rose-700 dark:text-rose-200",
    chip: "bg-rose-500/20 text-rose-700 dark:text-rose-200 ring-rose-500/40",
    barMid: "bg-rose-500/35",
    barCap: "bg-rose-500/55",
  },
};

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
  /** In-app delete confirmation state — replaces window.confirm so the
   *  experience matches the rest of the modal-driven UI and supports
   *  multi-option choices (single day vs entire period cluster). */
  const [deleteTarget, setDeleteTarget] = useState<PeriodLog | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

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

  // Cluster of contiguous period days around the current delete target — used
  // both in the dialog title and to build the action buttons. Computed once
  // per (target, logs) pair instead of re-walking on every parent render.
  const deleteCluster = useMemo(
    () => (deleteTarget ? getPeriodCluster(logByDate, deleteTarget) : []),
    [deleteTarget, logByDate]
  );

  // Recent-logs view collapses adjacent period days into a single timeline
  // entry. The grouper short-circuits at the display cap so we don't walk
  // the entire 180-log history every render.
  const recentGroups = useMemo(() => groupRecentLogs(logs, 30), [logs]);

  /** Low-level delete — performs the DB delete with optimistic local update.
   *  No confirmation prompt; callers must confirm via the in-app dialog. */
  async function performDelete(targets: PeriodLog[]): Promise<boolean> {
    if (targets.length === 0) return false;
    const ids = targets.map((t) => t.id);
    const prev = logs;
    setLogs((l) => l.filter((x) => !ids.includes(x.id)));
    const { error } = await supabase.from("period_logs").delete().in("id", ids);
    if (error) {
      setLogs(prev);
      setError(error.message);
      return false;
    }
    return true;
  }

  /** Open the delete confirmation dialog. The dialog itself decides whether
   *  to offer the "delete entire period" option based on cluster size. */
  function requestDelete(log: PeriodLog) {
    setDeleteTarget(log);
  }

  /** Bulk-upsert every day in [startDate, endDate] as a period day with the
   *  given flow, preserving each day's existing symptoms / mood / notes. */
  async function persistPeriodRange(
    startDate: string,
    endDate: string,
    flow: PeriodLog["flow"]
  ) {
    if (!user) return;
    if (startDate > endDate) return;
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
  }

  async function handleSaveRange(
    startDate: string,
    endDate: string,
    flow: PeriodLog["flow"]
  ) {
    await persistPeriodRange(startDate, endDate, flow);
    setRangeOpen(false);
  }

  async function handleSave(
    input: Omit<PeriodLog, "id" | "user_id">,
    untilDate?: string | null
  ) {
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
    // Extend the period to the optional "till" date. Skip the start day — it
    // was just saved with the full symptoms/mood/notes payload above.
    if (input.is_period && untilDate && untilDate > input.log_date) {
      const dayAfter = new Date(`${input.log_date}T00:00:00`);
      dayAfter.setDate(dayAfter.getDate() + 1);
      await persistPeriodRange(ymd(dayAfter), untilDate, input.flow ?? null);
    }
    setAddOpen(false);
    setEditing(null);
    setPickedDate(null);
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
            // Headline value: prefer the personal-average estimate, fall back
            // to the medical 28-day standard when the user has < 2 cycles.
            value={
              insights.predictedNext
                ? formatDate(insights.predictedNext)
                : insights.standardNext
                ? formatDate(insights.standardNext)
                : "—"
            }
            hint={
              insights.lastPeriodStart && insights.standardRange
                ? insights.predictedNext
                  ? `Personal avg: ~${insights.avgCycleDays}d from ${insights.cycleCount} cycle${insights.cycleCount === 1 ? "" : "s"} · Normal range: ${formatDate(insights.standardRange.start)} – ${formatDate(insights.standardRange.end)}`
                  : `Showing ${DEFAULT_CYCLE_DAYS}-day standard · Normal range: ${formatDate(insights.standardRange.start)} – ${formatDate(insights.standardRange.end)} · Log another cycle for a personal estimate`
                : "Mark a period start to predict"
            }
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[24rem_minmax(0,1fr)] items-start">
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
            standardNext={insights.standardNext}
            standardRange={insights.standardRange}
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
                {recentGroups.map((g) => (
                  <RecentLogRow
                    key={g.kind === "single" ? g.log.id : g.start.id}
                    group={g}
                    onEdit={(log) => setEditing(log)}
                    onDelete={(log) => requestDelete(log)}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

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
        onDelete={(log) => {
          // Hand off to the in-app confirm dialog. We close the edit dialog
          // after the user actually confirms (handled in the ConfirmDialog
          // callbacks below) so the user can cancel without losing state.
          requestDelete(log);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        busy={deleteBusy}
        onClose={() => setDeleteTarget(null)}
        title={
          deleteCluster.length > 1
            ? "Delete this period day?"
            : "Delete this log?"
        }
        description={
          deleteTarget
            ? `Log for ${formatDate(deleteTarget.log_date)}.`
            : undefined
        }
        actions={buildDeleteActions({
          target: deleteTarget,
          cluster: deleteCluster,
          busy: deleteBusy,
          onDelete: async (targets) => {
            setDeleteBusy(true);
            const ok = await performDelete(targets);
            setDeleteBusy(false);
            if (ok) {
              // Close any open edit dialog if we just removed its log.
              if (editing && targets.some((t) => t.id === editing.id)) {
                setEditing(null);
                setAddOpen(false);
                setPickedDate(null);
              }
              setDeleteTarget(null);
            }
          },
        })}
      />

      <PeriodRangeDialog
        open={rangeOpen}
        onClose={() => setRangeOpen(false)}
        onSave={handleSaveRange}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Recent-logs row — collapses contiguous period days into one entry. */
/* ------------------------------------------------------------------ */

function RecentLogRow({
  group,
  onEdit,
  onDelete,
}: {
  group: LogGroup;
  onEdit: (log: PeriodLog) => void;
  onDelete: (log: PeriodLog) => void;
}) {
  // Singletons render exactly like before — same markup, no aggregation.
  if (group.kind === "single") {
    const log = group.log;
    return (
      <li className="py-3 flex items-start justify-between gap-3 hover:bg-accent/30 -mx-3 px-3 rounded transition-colors">
        <div className="min-w-0 space-y-1.5 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{formatDate(log.log_date)}</span>
            {log.is_period && (
              <Badge variant="destructive" className="capitalize">
                <Droplets className="h-3 w-3" />
                Period
              </Badge>
            )}
            {log.is_period && log.flow && <FlowChip flow={log.flow} />}
            {log.mood && (
              <Badge variant="secondary">{moodEmoji(log.mood)} {log.mood}</Badge>
            )}
          </div>
          {log.symptoms.length > 0 && <SymptomList symptoms={log.symptoms} />}
          {log.notes && <NoteLine text={log.notes} />}
        </div>
        <RowActions
          label={formatDate(log.log_date)}
          onEdit={() => onEdit(log)}
          onDelete={() => onDelete(log)}
        />
      </li>
    );
  }

  // Cluster — aggregate values across the whole run so it reads as one entry.
  const { days, start, end } = group;
  const flows = new Set(days.map((d) => d.flow));
  const uniformFlow = flows.size === 1 ? days[0].flow : null;
  const allSymptoms = Array.from(new Set(days.flatMap((d) => d.symptoms ?? [])));
  // `days` arrives in DESC order (newest first); walk it oldest-first to pick
  // the earliest day that carries each field. One reverse, two searches.
  const oldestFirst = days.slice().reverse();
  const moodDay = oldestFirst.find((d) => !!d.mood);
  const noteDay = oldestFirst.find((d) => !!d.notes);

  return (
    <li className="py-3 flex items-start justify-between gap-3 hover:bg-accent/30 -mx-3 px-3 rounded transition-colors">
      <div className="min-w-0 space-y-1.5 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">
            {formatDateRange(start.log_date, end.log_date)}
          </span>
          <Badge variant="destructive">
            <Droplets className="h-3 w-3" />
            Period · {days.length} days
          </Badge>
          {uniformFlow ? (
            <FlowChip flow={uniformFlow} />
          ) : (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ring-1 ring-inset bg-muted text-muted-foreground ring-border"
              title={`Mixed flow: ${Array.from(flows).filter(Boolean).join(", ")}`}
            >
              Mixed flow
            </span>
          )}
          {moodDay?.mood && (
            <Badge variant="secondary" title={`On ${formatDate(moodDay.log_date)}`}>
              {moodEmoji(moodDay.mood)} {moodDay.mood}
            </Badge>
          )}
        </div>
        {allSymptoms.length > 0 && <SymptomList symptoms={allSymptoms} />}
        {noteDay?.notes && (
          <NoteLine
            text={noteDay.notes}
            hint={days.length > 1 ? `From ${formatDate(noteDay.log_date)}` : undefined}
          />
        )}
      </div>
      <RowActions
        label={`${formatDate(start.log_date)} – ${formatDate(end.log_date)}`}
        // Open the most recent day for edit so the pencil leads to the cell
        // the user most recently engaged with.
        onEdit={() => onEdit(end)}
        // Delegate to the cluster-aware confirm dialog (it offers "this day"
        // vs "entire period").
        onDelete={() => onDelete(end)}
      />
    </li>
  );
}

function FlowChip({ flow }: { flow: Flow }) {
  return (
    <span
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ring-1 ring-inset",
        FLOW_META[flow].chip
      )}
      title={`Flow: ${FLOW_META[flow].label}`}
    >
      {flow}
    </span>
  );
}

function SymptomList({ symptoms }: { symptoms: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {symptoms.map((s) => (
        <span
          key={s}
          className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
        >
          {s}
        </span>
      ))}
    </div>
  );
}

function NoteLine({ text, hint }: { text: string; hint?: string }) {
  return (
    <p className="text-xs text-muted-foreground italic border-l-2 border-primary/30 pl-2">
      {text}
      {hint && <span className="ml-1 not-italic text-[10px]">· {hint}</span>}
    </p>
  );
}

function RowActions({
  label,
  onEdit,
  onDelete,
}: {
  label: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 opacity-60 hover:opacity-100"
        aria-label={`Edit log for ${label}`}
        onClick={onEdit}
      >
        <Pencil className="h-4 w-4 text-muted-foreground" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 opacity-60 hover:opacity-100 hover:text-destructive"
        aria-label={`Delete log for ${label}`}
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4 text-muted-foreground" />
      </Button>
    </div>
  );
}

function PeriodLogDialog({
  open,
  initial,
  defaultDate,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  initial: PeriodLog | null;
  /** Pre-filled date for Add mode (e.g. when clicking a calendar cell). */
  defaultDate?: string | null;
  onClose: () => void;
  onSave: (
    input: Omit<PeriodLog, "id" | "user_id">,
    untilDate?: string | null
  ) => Promise<void>;
  /** Called when the user removes the currently-edited log. Only invoked in
   *  edit mode (when `initial` is non-null). */
  onDelete?: (log: PeriodLog) => Promise<void> | void;
}) {
  const [logDate, setLogDate] = useState(ymd());
  const [isPeriod, setIsPeriod] = useState(false);
  const [flow, setFlow] = useState<PeriodLog["flow"]>(null);
  /** Optional end-of-range date — when set, every day from `logDate`..`untilDate`
   *  is marked as a period day with the chosen flow. */
  const [untilDate, setUntilDate] = useState("");
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [mood, setMood] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** Inline validation message — set on submit when a mandatory field
   *  (currently: flow when "On my period today" is checked) is missing. */
  const [validationError, setValidationError] = useState<string | null>(null);

  // Sync form state with `initial` whenever the dialog opens. Reset when closed.
  useEffect(() => {
    if (!open) {
      setSaving(false);
      setDeleting(false);
      setValidationError(null);
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
    // Till date is never inferred — it's always an explicit, fresh action.
    setUntilDate("");
  }, [open, initial, defaultDate]);

  function toggleSymptom(s: string) {
    setSymptoms((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  // Range is only meaningful when the day itself is a period day AND the user
  // picked a later "till" date. Otherwise we save the single day only.
  const rangeUntil: string | null =
    isPeriod && !!untilDate && untilDate > logDate ? untilDate : null;
  const rangeDayCount = useMemo(() => {
    if (!rangeUntil) return 0;
    const a = new Date(`${logDate}T00:00:00`).getTime();
    const b = new Date(`${rangeUntil}T00:00:00`).getTime();
    return Math.round((b - a) / 86_400_000) + 1;
  }, [logDate, rangeUntil]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Mandatory-field guard: a period day must have a flow selected so the
    // calendar and recent-logs list can render it meaningfully.
    if (isPeriod && !flow) {
      setValidationError("Please pick a flow — it's required when marking a period day.");
      return;
    }
    setValidationError(null);
    setSaving(true);
    await onSave(
      {
        log_date: logDate,
        is_period: isPeriod,
        flow: isPeriod ? flow : null,
        symptoms,
        mood: mood || null,
        notes: notes.trim() || null,
      },
      rangeUntil
    );
    setSaving(false);
  }

  async function onDeleteClick() {
    if (!initial || !onDelete) return;
    setDeleting(true);
    await onDelete(initial);
    setDeleting(false);
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
              onChange={(e) => {
                setIsPeriod(e.target.checked);
                if (!e.target.checked) setValidationError(null);
              }}
              className="h-4 w-4 rounded border-input"
            />
            On my period today
          </label>
          {isPeriod && (
            <div className="space-y-1.5">
              <Label htmlFor="p-flow">
                Flow <span className="text-destructive">*</span>
              </Label>
              <Select
                id="p-flow"
                value={flow ?? ""}
                required
                aria-invalid={!!validationError && !flow}
                onChange={(e) => {
                  const next = (e.target.value || null) as PeriodLog["flow"];
                  setFlow(next);
                  if (next) setValidationError(null);
                }}
                className={cn(
                  validationError && !flow && "border-destructive focus-visible:ring-destructive"
                )}
              >
                <option value="">Pick a flow…</option>
                <option value="light">Light</option>
                <option value="medium">Medium</option>
                <option value="heavy">Heavy</option>
              </Select>
              {validationError && !flow && (
                <p className="text-[11px] text-destructive">{validationError}</p>
              )}
            </div>
          )}
          {isPeriod && (
            <div className="space-y-1.5 pt-1">
              <Label htmlFor="p-until">Till date (optional)</Label>
              <DateField
                id="p-until"
                value={untilDate}
                onChange={setUntilDate}
                min={logDate}
              />
              <p className="text-[11px] text-muted-foreground">
                {rangeUntil
                  ? `Marks ${rangeDayCount} day${rangeDayCount === 1 ? "" : "s"} as period (${formatDate(logDate)} → ${formatDate(rangeUntil)}). Symptoms, mood, and notes apply to the start day only.`
                  : "Leave empty to log a single day. Otherwise every day in the range will be marked as a period day."}
              </p>
            </div>
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

        <div className="flex items-center gap-2 pt-2">
          {initial && onDelete && (
            <Button
              type="button"
              variant="ghost"
              onClick={onDeleteClick}
              disabled={saving || deleting}
              className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" /> {deleting ? "Deleting…" : "Delete"}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose} disabled={deleting} className="ml-auto">
            Cancel
          </Button>
          <Button type="submit" disabled={saving || deleting}>
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
  standardNext,
  standardRange,
  onPickDate,
}: {
  month: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  logByDate: Map<string, PeriodLog>;
  /** Personal-average prediction (null when <2 cycles). */
  predictedNext: string | null;
  /** 28-day midpoint of the normal range — gets the marker dot. */
  standardNext: string | null;
  /** 21..35 day "normal" window — always rendered when any period exists. */
  standardRange: { start: string; end: string } | null;
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

  // Predicted (personal avg) = 5-day window starting from `predictedNext` so
  // the timeline has a proper start cap and end cap. Only present when the
  // user has logged 2+ cycles.
  const predictedDates = useMemo(() => {
    const out = new Set<string>();
    if (!predictedNext) return out;
    const start = new Date(`${predictedNext}T00:00:00`);
    for (let i = 0; i < 5; i++) out.add(ymd(addDays(start, i)));
    return out;
  }, [predictedNext]);

  // Standard "normal-range" window (day 21..35 from the last period start).
  // Drawn as a SEPARATE track in a different style so users can distinguish
  // their personal estimate from the medical baseline at a glance.
  const standardDates = useMemo(() => {
    const out = new Set<string>();
    if (!standardRange) return out;
    const start = new Date(`${standardRange.start}T00:00:00`);
    const end = new Date(`${standardRange.end}T00:00:00`);
    const span = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    for (let i = 0; i <= span; i++) out.add(ymd(addDays(start, i)));
    return out;
  }, [standardRange]);

  // Per-cell run position for each state. Runs break at week boundaries so a
  // row wrap renders as an end-cap on Saturday + a fresh start-cap on Sunday.
  const runs = useMemo(() => {
    const isPeriodAt = (i: number) => !!logByDate.get(cells[i].key)?.is_period;
    const isSymAt = (i: number) => {
      const l = logByDate.get(cells[i].key);
      return !!l && !l.is_period && l.symptoms.length > 0;
    };
    const isPredAt = (i: number) => predictedDates.has(cells[i].key);
    const isStdAt = (i: number) => standardDates.has(cells[i].key);

    return cells.map((_, i) => {
      const col = i % 7;
      const hasPrev = (fn: (j: number) => boolean) => col > 0 && fn(i - 1);
      const hasNext = (fn: (j: number) => boolean) => col < 6 && i + 1 < cells.length && fn(i + 1);
      return {
        period: runPos(isPeriodAt(i), hasPrev(isPeriodAt), hasNext(isPeriodAt)),
        sym: runPos(isSymAt(i), hasPrev(isSymAt), hasNext(isSymAt)),
        pred: runPos(isPredAt(i), hasPrev(isPredAt), hasNext(isPredAt)),
        std: runPos(isStdAt(i), hasPrev(isStdAt), hasNext(isStdAt)),
      };
    });
  }, [cells, logByDate, predictedDates, standardDates]);

  return (
    // ~10cm × ~10cm: 380px-wide card, sized to its content.
    <Card className="mx-auto w-full max-w-[24rem]">
      <CardHeader className="p-3 pb-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Calendar className="h-3.5 w-3.5 text-primary" /> Cycle Calendar
          </CardTitle>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" aria-label="Previous month" onClick={onPrev} className="h-6 w-6">
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Next month" onClick={onNext} className="h-6 w-6">
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onToday}
              className="ml-0.5 h-6 px-1.5 text-[10px] font-medium"
            >
              Today
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {monthLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-1">
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((d) => (
            <div
              key={d}
              className="text-center text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {d[0]}
            </div>
          ))}
          {cells.map(({ date, key, inMonth }, i) => {
            const log = logByDate.get(key);
            const isPeriod = !!log?.is_period;
            const hasSymptoms = !!log && !log.is_period && log.symptoms.length > 0;
            const isToday = key === todayKey;
            const isPredictedStart = key === predictedNext;
            const isStandardStart = key === standardNext;
            const flow = log?.flow;
            const r = runs[i];

            return (
              <button
                key={key}
                type="button"
                onClick={() => onPickDate(key)}
                aria-label={`${formatDate(key)}${
                  isPeriod
                    ? " — period"
                    : hasSymptoms
                    ? " — symptoms"
                    : isPredictedStart
                    ? " — predicted next period"
                    : isStandardStart
                    ? " — standard 28-day cycle"
                    : r.std !== "none"
                    ? " — within normal cycle range"
                    : ""
                }`}
                aria-pressed={isPeriod || hasSymptoms}
                className={cn(
                  "relative aspect-square flex items-center justify-center text-[10px] leading-none transition-colors rounded-full",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                  !inMonth && "opacity-30",
                  !isPeriod && !hasSymptoms && "hover:bg-muted/40"
                )}
              >
                {/* Standard "normal-range" window (21..35 days) — drawn first
                 *  so the personal-avg and logged data sit on top of it. */}
                {r.std !== "none" && !isPeriod && (
                  <RunBar
                    pos={r.std}
                    className="border border-dotted border-amber-500/60 bg-amber-500/5"
                  />
                )}
                {/* Predicted (personal-avg) timeline — only when 2+ cycles
                 *  exist. Distinct dashed primary stroke vs the dotted amber
                 *  standard window above. */}
                {r.pred !== "none" && !isPeriod && (
                  <RunBar
                    pos={r.pred}
                    className="border border-dashed border-primary/60 bg-primary/10"
                  />
                )}
                {/* Symptoms timeline */}
                {r.sym !== "none" && (
                  <RunBar
                    pos={r.sym}
                    className={
                      r.sym === "middle"
                        ? "bg-emerald-500/15"
                        : "bg-emerald-500/35 ring-1 ring-inset ring-emerald-500/40"
                    }
                  />
                )}
                {/* Period timeline — start/end caps darker than the middle */}
                {r.period !== "none" && (
                  <RunBar
                    pos={r.period}
                    className={cn(
                      r.period === "middle"
                        ? FLOW_META[flow ?? "light"].barMid
                        : cn("ring-1 ring-inset ring-rose-500/50", FLOW_META[flow ?? "light"].barCap)
                    )}
                  />
                )}
                {isToday && (
                  <span aria-hidden className="absolute inset-0.5 rounded-full ring-1 ring-primary" />
                )}
                {isPredictedStart && !isPeriod && (
                  <span
                    aria-hidden
                    title="Personal-average expected day"
                    className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-background"
                  />
                )}
                {isStandardStart && !isPredictedStart && !isPeriod && (
                  <span
                    aria-hidden
                    title="Standard 28-day cycle"
                    className="absolute -top-0.5 -left-0.5 h-1.5 w-1.5 rounded-full bg-amber-500 ring-2 ring-background"
                  />
                )}
                <span
                  className={cn(
                    "relative tabular-nums",
                    isPeriod && "text-rose-700 dark:text-rose-200 font-semibold",
                    !isPeriod && hasSymptoms && "text-emerald-700 dark:text-emerald-300"
                  )}
                >
                  {date.getDate()}
                </span>
                {/* Flow indicator (L/M/H) — drawn only once per contiguous
                 *  run so the cluster reads as a single timeline entry
                 *  instead of N labelled chunks. */}
                {isPeriod && flow && (r.period === "start" || r.period === "single") && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute bottom-0 right-0 text-[8px] font-bold leading-none px-0.5 rounded-sm",
                      "bg-background/90 ring-1 ring-rose-500/40",
                      FLOW_META[flow].letterText
                    )}
                  >
                    {FLOW_META[flow].letter}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[9px] text-muted-foreground">
          <LegendBar
            label="Period"
            capClass="bg-rose-500/55 ring-1 ring-inset ring-rose-500/50"
            barClass="bg-rose-500/25"
          />
          <LegendBar
            label="Symptoms"
            capClass="bg-emerald-500/35 ring-1 ring-inset ring-emerald-500/40"
            barClass="bg-emerald-500/15"
          />
          <LegendBar
            label="Predicted (avg)"
            capClass="border border-dashed border-primary/60 bg-primary/10"
            barClass="border-y border-dashed border-primary/60 bg-primary/10"
          />
          <LegendBar
            label="Normal range (21–35d)"
            capClass="border border-dotted border-amber-500/60 bg-amber-500/5"
            barClass="border-y border-dotted border-amber-500/60 bg-amber-500/5"
          />
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Avg day
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            28-day
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full ring-1 ring-primary" />
            Today
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-flex items-center gap-0.5 font-bold tabular-nums">
              <span className="text-rose-500 dark:text-rose-300">L</span>
              <span className="text-rose-600 dark:text-rose-300">M</span>
              <span className="text-rose-700 dark:text-rose-200">H</span>
            </span>
            Flow
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

type RunPos = "none" | "single" | "start" | "middle" | "end";

function runPos(curr: boolean, prev: boolean, next: boolean): RunPos {
  if (!curr) return "none";
  if (!prev && !next) return "single";
  if (!prev && next) return "start";
  if (prev && next) return "middle";
  return "end";
}

/** A timeline segment drawn inside one calendar cell. The start/end variants
 *  bleed 2px into the 4px column gap so consecutive cells visually connect. */
function RunBar({
  pos,
  className,
}: {
  pos: Exclude<RunPos, "none">;
  className: string;
}) {
  const shape =
    pos === "single"
      ? "inset-x-1 rounded-full"
      : pos === "start"
      ? "left-1 right-[-2px] rounded-l-full"
      : pos === "end"
      ? "left-[-2px] right-1 rounded-r-full"
      : "left-[-2px] right-[-2px]";
  return <span aria-hidden className={cn("absolute inset-y-1", shape, className)} />;
}

/** Legend entry showing a miniature timeline: [cap]—bar—[cap]. */
function LegendBar({
  label,
  capClass,
  barClass,
}: {
  label: string;
  capClass: string;
  barClass: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex items-center">
        <span className={cn("h-2 w-1.5 rounded-l-full", capClass)} />
        <span className={cn("h-2 w-2", barClass)} />
        <span className={cn("h-2 w-1.5 rounded-r-full", capClass)} />
      </span>
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

/** Returns the contiguous run of period days that includes `target`, by
 *  walking both directions while neighbouring days remain `is_period`. The
 *  caller-supplied `logByDate` map is reused — avoids re-allocating the
 *  lookup on every parent render. */
function getPeriodCluster(
  logByDate: Map<string, PeriodLog>,
  target: PeriodLog
): PeriodLog[] {
  if (!target.is_period) return [target];
  const cluster: PeriodLog[] = [target];
  const base = new Date(`${target.log_date}T00:00:00`);
  for (let i = -1; ; i--) {
    const l = logByDate.get(ymd(addDays(base, i)));
    if (l?.is_period) cluster.unshift(l);
    else break;
  }
  for (let i = 1; ; i++) {
    const l = logByDate.get(ymd(addDays(base, i)));
    if (l?.is_period) cluster.push(l);
    else break;
  }
  return cluster;
}

/** Either a one-off log row, or a contiguous run of period days that should
 *  render as a single "entire-log" entry in the Recent Logs list. */
type LogGroup =
  | { kind: "single"; log: PeriodLog }
  | { kind: "cluster"; days: PeriodLog[]; start: PeriodLog; end: PeriodLog };

/** Walks a DESC-sorted log list and collapses contiguous period days
 *  (calendar-adjacent, regardless of flow) into a single cluster entry.
 *  Non-period logs and isolated period days remain singles. `limit`
 *  short-circuits once that many groups have been produced — avoids walking
 *  the full 180-row history when only the top-N are rendered. */
function groupRecentLogs(logsDesc: PeriodLog[], limit = Infinity): LogGroup[] {
  const groups: LogGroup[] = [];
  let i = 0;
  while (i < logsDesc.length && groups.length < limit) {
    const cur = logsDesc[i];
    if (!cur.is_period) {
      groups.push({ kind: "single", log: cur });
      i++;
      continue;
    }
    const days: PeriodLog[] = [cur];
    let j = i + 1;
    while (j < logsDesc.length && logsDesc[j].is_period) {
      const lastDate = days[days.length - 1].log_date;
      const expectedPrev = ymd(addDays(new Date(`${lastDate}T00:00:00`), -1));
      if (logsDesc[j].log_date !== expectedPrev) break;
      days.push(logsDesc[j]);
      j++;
    }
    if (days.length === 1) {
      groups.push({ kind: "single", log: cur });
    } else {
      // `days` is DESC (newest first) — start = oldest, end = newest.
      groups.push({ kind: "cluster", days, start: days[days.length - 1], end: days[0] });
    }
    i = j;
  }
  return groups;
}

/** Pretty-print a date range with the smallest readable form: same-month
 *  collapses to "May 11 – 14, 2026"; same-year shortens the year on the
 *  left side; otherwise falls back to two full dates. */
function formatDateRange(startIso: string, endIso: string): string {
  if (startIso === endIso) return formatDate(startIso);
  const a = new Date(startIso);
  const b = new Date(endIso);
  const sameYear = a.getFullYear() === b.getFullYear();
  const sameMonth = sameYear && a.getMonth() === b.getMonth();
  if (sameMonth) {
    const left = a.toLocaleDateString([], { month: "short", day: "numeric" });
    const right = b.toLocaleDateString([], { day: "numeric", year: "numeric" });
    return `${left} – ${right}`;
  }
  if (sameYear) {
    const left = a.toLocaleDateString([], { month: "short", day: "numeric" });
    return `${left} – ${formatDate(endIso)}`;
  }
  return `${formatDate(startIso)} – ${formatDate(endIso)}`;
}

/** Build the action buttons for the delete confirm dialog. Offers a second
 *  "Delete entire period" choice when the target is part of a multi-day
 *  cluster, otherwise falls back to a single destructive Delete button. */
function buildDeleteActions({
  target,
  cluster,
  busy,
  onDelete,
}: {
  target: PeriodLog | null;
  cluster: PeriodLog[];
  busy: boolean;
  onDelete: (targets: PeriodLog[]) => Promise<void>;
}): ConfirmAction[] {
  if (!target) return [];
  if (cluster.length <= 1) {
    return [
      {
        id: "delete",
        label: busy ? "Deleting…" : "Delete",
        variant: "destructive",
        onClick: () => onDelete([target]),
      },
    ];
  }
  return [
    {
      id: "delete-day",
      label: busy ? "Working…" : "Delete this day",
      variant: "outline",
      onClick: () => onDelete([target]),
    },
    {
      id: "delete-cluster",
      label: busy ? "Working…" : `Delete entire period (${cluster.length} days)`,
      variant: "destructive",
      onClick: () => onDelete(cluster),
    },
  ];
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
/** Medical reference window for "normal" cycle length (ACOG/WHO). The
 *  calendar marks this range after every logged period so the user always
 *  has a baseline expectation — independent of their personal average,
 *  which only becomes available after two cycles. */
const NORMAL_CYCLE_MIN = 21;
const NORMAL_CYCLE_MAX = 35;

export function computeCycleInsights(logs: PeriodLog[]): {
  lastPeriodStart: string | null;
  avgCycleDays: number | null;
  /** Personal-average prediction. Null until 2+ cycles are logged — we no
   *  longer silently fall back to the 28-day standard so the "average"
   *  insight isn't misrepresented. */
  predictedNext: string | null;
  /** Number of cycle-gaps used to compute the average (0 when no real avg). */
  cycleCount: number;
  /** Always-computed 28-day-cycle midpoint (medical standard reference)
   *  shown alongside the personalised user-average prediction. Null only
   *  when no period start has been logged yet. */
  standardNext: string | null;
  /** Inclusive [start, end] window covering the 21..35 day "normal" range
   *  from the last period start. Always set once any period exists. */
  standardRange: { start: string; end: string } | null;
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
    return {
      lastPeriodStart: null,
      avgCycleDays: null,
      predictedNext: null,
      cycleCount: 0,
      standardNext: null,
      standardRange: null,
    };
  }
  const lastPeriodStart = firstDays[firstDays.length - 1];
  const lastStartDate = new Date(`${lastPeriodStart}T00:00:00`);
  const standardNext = ymd(addDays(lastStartDate, DEFAULT_CYCLE_DAYS));
  const standardRange = {
    start: ymd(addDays(lastStartDate, NORMAL_CYCLE_MIN)),
    end: ymd(addDays(lastStartDate, NORMAL_CYCLE_MAX)),
  };

  // With only one logged period start we can't compute a personal average —
  // leave `predictedNext` null; the standard range still surfaces a baseline.
  if (firstDays.length < 2) {
    return {
      lastPeriodStart,
      avgCycleDays: null,
      predictedNext: null,
      cycleCount: 0,
      standardNext,
      standardRange,
    };
  }

  const diffs: number[] = [];
  for (let i = 1; i < firstDays.length; i++) {
    const a = new Date(firstDays[i - 1]);
    const b = new Date(firstDays[i]);
    diffs.push(Math.round((b.getTime() - a.getTime()) / 86_400_000));
  }
  const avg = Math.round(diffs.reduce((s, n) => s + n, 0) / diffs.length);
  return {
    lastPeriodStart,
    avgCycleDays: avg,
    predictedNext: ymd(addDays(lastStartDate, avg)),
    cycleCount: diffs.length,
    standardNext,
    standardRange,
  };
}
