import { FormEvent, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Droplet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Dialog } from "@/components/ui/Dialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import type { GlucoseReading } from "@/types";
import { formatDate, formatTime } from "@/lib/dates";

const MEAL_CONTEXTS = ["fasting", "before_meal", "after_meal", "bedtime", "random"] as const;

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
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Diabetes</h1>
          <p className="text-muted-foreground">Monitor your glucose readings and trends.</p>
        </div>
        <Button onClick={() => setAddOpen(true)} disabled={loading}>
          <Plus className="h-4 w-4" /> Add Reading
        </Button>
      </header>

      {error && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Average" value={stats ? `${stats.avg}` : "—"} hint="mg/dL" />
        <StatCard label="Estimated A1C" value={stats ? `${stats.eA1c}%` : "—"} hint="From avg" />
        <StatCard label="In range" value={stats ? `${stats.inRangePct}%` : "—"} hint={`${RANGE_LOW}–${RANGE_HIGH} mg/dL`} />
        <StatCard label="Out of range" value={stats ? `${stats.lowPct + stats.highPct}%` : "—"} hint={stats ? `${stats.lowPct}% low · ${stats.highPct}% high` : ""} />
      </div>

      {trend.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Trend</CardTitle>
            <CardDescription>Last {trend.length} readings, oldest → newest. Bands at {RANGE_LOW} / {RANGE_HIGH} mg/dL.</CardDescription>
          </CardHeader>
          <CardContent>
            <TrendChart readings={trend} />
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : readings.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Droplet className="h-10 w-10 mx-auto mb-3 opacity-50" />
            No readings yet. Click <strong>Add Reading</strong> to log your first measurement.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Recent readings</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {readings.slice(0, 30).map((r) => {
                const status =
                  r.value_mg_dl < RANGE_LOW ? "low" : r.value_mg_dl > RANGE_HIGH ? "high" : "in";
                const statusClass =
                  status === "low"
                    ? "text-amber-600 dark:text-amber-400"
                    : status === "high"
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-emerald-600 dark:text-emerald-400";
                return (
                  <li key={r.id} className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className={`font-semibold ${statusClass}`}>
                        {r.value_mg_dl} <span className="font-normal text-xs text-muted-foreground">mg/dL</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(r.measured_at)} · {formatTime(r.measured_at)}
                        {r.meal_context ? ` · ${r.meal_context.replace("_", " ")}` : ""}
                      </p>
                      {r.notes && <p className="text-xs text-muted-foreground italic">{r.notes}</p>}
                    </div>
                    <Button variant="ghost" size="icon" aria-label="Delete reading" onClick={() => deleteReading(r)}>
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

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="p-5 space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
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
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setValue("");
      setMeasuredAt(localDateTimeNow());
      setContext(null);
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
          <Label htmlFor="g-ctx">Context</Label>
          <Select id="g-ctx" value={context ?? ""} onChange={(e) => setContext((e.target.value || null) as GlucoseReading["meal_context"])}>
            <option value="">None</option>
            {MEAL_CONTEXTS.map((c) => (
              <option key={c} value={c}>{c.replace("_", " ")}</option>
            ))}
          </Select>
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
