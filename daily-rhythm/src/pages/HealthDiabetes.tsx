import { FormEvent, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Droplet, TrendingUp, Activity, Target, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Dialog } from "@/components/ui/Dialog";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { ExportButton } from "@/components/ui/ExportButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonStatGrid, SkeletonCard } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import type { GlucoseReading } from "@/types";
import { formatDate, formatTime } from "@/lib/dates";
import { exportReport } from "@/lib/export";
import { cn } from "@/lib/utils";

/** Ordered list of meal-context values shown in the picker, with display labels.
 * The legacy generic values ("before_meal", "after_meal", "random") are still
 * accepted by the database but are no longer offered in the dropdown — old
 * readings continue to display correctly via {@link mealContextLabel}. */
const MEAL_CONTEXTS: { value: NonNullable<GlucoseReading["meal_context"]>; label: string }[] = [
  { value: "fasting", label: "Fasting" },
  { value: "before_breakfast", label: "Before Breakfast" },
  { value: "after_breakfast", label: "After Breakfast" },
  { value: "before_lunch", label: "Before Lunch" },
  { value: "after_lunch", label: "After Lunch" },
  { value: "before_dinner", label: "Before Dinner" },
  { value: "after_dinner", label: "After Dinner" },
  { value: "bedtime", label: "Bedtime" },
];

function mealContextLabel(ctx: GlucoseReading["meal_context"]): string {
  if (!ctx) return "";
  const known = MEAL_CONTEXTS.find((m) => m.value === ctx);
  if (known) return known.label;
  // Legacy values: humanize underscores and title-case.
  return ctx
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Standard target range for adults with diabetes (mg/dL).
const RANGE_LOW = 70;
const RANGE_HIGH = 180;

export function HealthDiabetesPage() {
  const { user } = useAuth();
  const [readings, setReadings] = useState<GlucoseReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("glucose_readings")
        .select("*")
        .order("measured_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (error) setError(error.message);
      else setReadings(data ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const stats = useMemo(() => {
    if (readings.length === 0) return null;
    const values = readings.map((r) => r.value_mg_dl);
    const avg = Math.round(values.reduce((s, n) => s + n, 0) / values.length);
    const inRange = readings.filter((r) => r.value_mg_dl >= RANGE_LOW && r.value_mg_dl <= RANGE_HIGH).length;
    const low = readings.filter((r) => r.value_mg_dl < RANGE_LOW).length;
    const high = readings.filter((r) => r.value_mg_dl > RANGE_HIGH).length;
    // Estimated A1C: standard formula (avg + 46.7) / 28.7
    const eA1c = ((avg + 46.7) / 28.7).toFixed(1);
    return {
      avg,
      eA1c,
      inRangePct: Math.round((inRange / readings.length) * 100),
      lowPct: Math.round((low / readings.length) * 100),
      highPct: Math.round((high / readings.length) * 100),
    };
  }, [readings]);

  // Last 14 readings for tiny trend line (oldest -> newest, left -> right).
  const trend = useMemo(() => readings.slice(0, 14).slice().reverse(), [readings]);

  async function deleteReading(r: GlucoseReading) {
    if (!confirm("Delete this reading?")) return;
    const prev = readings;
    setReadings((rs) => rs.filter((x) => x.id !== r.id));
    const { error } = await supabase.from("glucose_readings").delete().eq("id", r.id);
    if (error) {
      setReadings(prev);
      setError(error.message);
    }
  }

  async function handleSave(input: Omit<GlucoseReading, "id" | "user_id">) {
    if (!user) return;
    const { data, error } = await supabase
      .from("glucose_readings")
      .insert({ user_id: user.id, ...input })
      .select()
      .single();
    if (error || !data) {
      setError(error?.message ?? "Save failed");
      return;
    }
    setReadings((prev) => [data, ...prev]);
    setAddOpen(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Diabetes"
        icon={<Droplet className="h-5 w-5" />}
        description="Monitor your glucose readings and trends."
        actions={
          <div className="flex items-center gap-2">
            <ExportButton
              disabled={loading || readings.length === 0}
              onExport={(format) =>
                exportReport({
                  name: "glucose-readings",
                  format,
                  rows: readings.map((r) => ({
                    measured_at: r.measured_at,
                    value_mg_dl: r.value_mg_dl,
                    meal_context: r.meal_context ?? "",
                    meal_context_label: mealContextLabel(r.meal_context),
                    meal_description: r.meal_description ?? "",
                    notes: r.notes ?? "",
                    id: r.id,
                  })),
                  columns: [
                    "measured_at", "value_mg_dl", "meal_context",
                    "meal_context_label", "meal_description", "notes", "id",
                  ],
                  meta: stats
                    ? {
                        source: "diabetes",
                        target_range: { low: RANGE_LOW, high: RANGE_HIGH },
                        summary: stats,
                      }
                    : { source: "diabetes" },
                })
              }
            />
            <Button onClick={() => setAddOpen(true)} disabled={loading}>
              <Plus className="h-4 w-4" /> Add Reading
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
        <SkeletonStatGrid />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            accent="primary"
            icon={<Activity className="h-4 w-4" />}
            label="Average"
            value={stats ? `${stats.avg}` : "—"}
            hint="mg/dL"
          />
          <StatCard
            accent="indigo"
            icon={<TrendingUp className="h-4 w-4" />}
            label="Est. A1C"
            value={stats ? `${stats.eA1c}%` : "—"}
            hint="From rolling avg"
          />
          <StatCard
            accent="emerald"
            icon={<Target className="h-4 w-4" />}
            label="In range"
            value={stats ? `${stats.inRangePct}%` : "—"}
            hint={`${RANGE_LOW}–${RANGE_HIGH} mg/dL`}
          />
          <StatCard
            accent="rose"
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Out of range"
            value={stats ? `${stats.lowPct + stats.highPct}%` : "—"}
            hint={stats ? `${stats.lowPct}% low · ${stats.highPct}% high` : ""}
          />
        </div>
      )}

      {trend.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trend</CardTitle>
            <CardDescription>
              Last {trend.length} readings, oldest → newest. Green band marks {RANGE_LOW}–{RANGE_HIGH} mg/dL.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TrendChart readings={trend} />
          </CardContent>
        </Card>
      )}

      {loading ? (
        <SkeletonCard rows={4} />
      ) : readings.length === 0 ? (
        <EmptyState
          icon={<Droplet className="h-7 w-7" />}
          title="No readings yet"
          description="Log glucose readings throughout the day. Trends, in-range %, and estimated A1C will appear automatically."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Add your first reading
            </Button>
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent readings</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border -mt-2">
              {readings.slice(0, 30).map((r) => {
                const status =
                  r.value_mg_dl < RANGE_LOW ? "low" : r.value_mg_dl > RANGE_HIGH ? "high" : "in";
                const barClass =
                  status === "low"
                    ? "bg-amber-500"
                    : status === "high"
                    ? "bg-rose-500"
                    : "bg-emerald-500";
                const valueClass =
                  status === "low"
                    ? "text-amber-600 dark:text-amber-400"
                    : status === "high"
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-emerald-600 dark:text-emerald-400";
                return (
                  <li
                    key={r.id}
                    className="py-3 flex items-center justify-between gap-3 hover:bg-accent/30 -mx-3 px-3 rounded transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span
                        aria-hidden
                        className={cn("h-10 w-1 rounded-full shrink-0", barClass)}
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-base">
                          <span className={valueClass}>{r.value_mg_dl}</span>{" "}
                          <span className="font-normal text-xs text-muted-foreground">mg/dL</span>
                          {r.meal_context && (
                            <Badge variant="secondary" className="ml-2">
                              {mealContextLabel(r.meal_context)}
                            </Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(r.measured_at)} · {formatTime(r.measured_at)}
                        </p>
                        {r.meal_description && (
                          <p className="text-xs text-foreground/80 mt-1">
                            🍽 {r.meal_description}
                          </p>
                        )}
                        {r.notes && (
                          <p className="text-xs text-muted-foreground italic mt-1 border-l-2 border-primary/30 pl-2">
                            {r.notes}
                          </p>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-60 hover:opacity-100"
                      aria-label="Delete reading"
                      onClick={() => deleteReading(r)}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <AddReadingDialog open={addOpen} onClose={() => setAddOpen(false)} onSave={handleSave} />
    </div>
  );
}

const STAT_ACCENTS = {
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
} as const;

function StatCard({
  accent,
  icon,
  label,
  value,
  hint,
}: {
  accent: keyof typeof STAT_ACCENTS;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  const a = STAT_ACCENTS[accent];
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
        <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground truncate">{hint}</p>
      </CardContent>
    </Card>
  );
}

function TrendChart({ readings }: { readings: GlucoseReading[] }) {
  const W = 600;
  const H = 160;
  const pad = 24;
  const values = readings.map((r) => r.value_mg_dl);
  const min = Math.min(40, ...values);
  const max = Math.max(220, ...values);
  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, readings.length - 1);
  const y = (v: number) => H - pad - ((v - min) / (max - min)) * (H - pad * 2);
  const path = readings.map((r, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(r.value_mg_dl).toFixed(1)}`).join(" ");
  const lowY = y(RANGE_LOW);
  const highY = y(RANGE_HIGH);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40" role="img" aria-label="Glucose trend">
      <rect x={pad} y={highY} width={W - pad * 2} height={lowY - highY} className="fill-emerald-500/10" />
      <line x1={pad} x2={W - pad} y1={lowY} y2={lowY} className="stroke-emerald-500/40" strokeDasharray="4 4" />
      <line x1={pad} x2={W - pad} y1={highY} y2={highY} className="stroke-emerald-500/40" strokeDasharray="4 4" />
      <path d={path} className="fill-none stroke-primary" strokeWidth={2} />
      {readings.map((r, i) => (
        <circle key={r.id} cx={x(i)} cy={y(r.value_mg_dl)} r={3} className="fill-primary" />
      ))}
    </svg>
  );
}

function AddReadingDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (input: Omit<GlucoseReading, "id" | "user_id">) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [measuredAt, setMeasuredAt] = useState(localDateTimeNow());
  const [context, setContext] = useState<GlucoseReading["meal_context"]>(null);
  const [mealDescription, setMealDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setValue("");
      setMeasuredAt(localDateTimeNow());
      setContext(null);
      setMealDescription("");
      setNotes("");
      setSaving(false);
    }
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const v = parseInt(value, 10);
    if (!Number.isFinite(v) || v < 20 || v > 700) return;
    setSaving(true);
    await onSave({
      measured_at: new Date(measuredAt).toISOString(),
      value_mg_dl: v,
      meal_context: context,
      meal_description: mealDescription.trim() || null,
      notes: notes.trim() || null,
    });
    setSaving(false);
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add reading" description="Log a glucose measurement.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="g-val">Value (mg/dL)</Label>
            <Input id="g-val" type="number" min={20} max={700} value={value} onChange={(e) => setValue(e.target.value)} required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-when">When</Label>
            <Input id="g-when" type="datetime-local" value={measuredAt} onChange={(e) => setMeasuredAt(e.target.value)} required />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-ctx">Time</Label>
          <Select id="g-ctx" value={context ?? ""} onChange={(e) => setContext((e.target.value || null) as GlucoseReading["meal_context"])}>
            <option value="">None</option>
            {MEAL_CONTEXTS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-meal">Meal description</Label>
          <Textarea
            id="g-meal"
            value={mealDescription}
            onChange={(e) => setMealDescription(e.target.value)}
            placeholder="What did you eat? e.g. 2 idli + sambar, or skipped breakfast"
            maxLength={500}
            rows={2}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-notes">Notes</Label>
          <Textarea id="g-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save reading"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function localDateTimeNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
