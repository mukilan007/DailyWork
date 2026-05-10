import { FormEvent, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Heart, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Dialog } from "@/components/ui/Dialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import type { PeriodLog } from "@/types";
import { ymd, formatDate } from "@/lib/dates";

const SYMPTOM_OPTIONS = ["Cramps", "Headache", "Bloating", "Fatigue", "Acne", "Tender breasts", "Backache", "Nausea"] as const;
const MOOD_OPTIONS = ["Happy", "Calm", "Anxious", "Sad", "Irritable", "Energetic", "Tired"] as const;

export function HealthPeriodPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<PeriodLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

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
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Period Tracker</h1>
          <p className="text-muted-foreground">Track your cycle, symptoms, and mood.</p>
        </div>
        <Button onClick={() => setAddOpen(true)} disabled={loading}>
          <Plus className="h-4 w-4" /> Add Log
        </Button>
      </header>

      {error && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5 space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last period</p>
            <p className="text-2xl font-semibold">{insights.lastPeriodStart ? formatDate(insights.lastPeriodStart) : "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Avg cycle</p>
            <p className="text-2xl font-semibold">{insights.avgCycleDays != null ? `${insights.avgCycleDays} days` : "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Predicted next</p>
            <p className="text-2xl font-semibold">{insights.predictedNext ? formatDate(insights.predictedNext) : "—"}</p>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : logs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Heart className="h-10 w-10 mx-auto mb-3 opacity-50" />
            No logs yet. Click <strong>Add Log</strong> to record your first entry.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" /> Recent logs
            </CardTitle>
            <CardDescription>Most recent first.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {logs.slice(0, 30).map((log) => (
                <li key={log.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{formatDate(log.log_date)}</span>
                      {log.is_period && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400">
                          Period{log.flow ? ` · ${log.flow}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                      {log.mood && <span>Mood: {log.mood}</span>}
                      {log.symptoms.length > 0 && <span>· {log.symptoms.join(", ")}</span>}
                    </div>
                    {log.notes && <p className="text-xs text-muted-foreground italic">{log.notes}</p>}
                  </div>
                  <Button variant="ghost" size="icon" aria-label="Delete log" onClick={() => deleteLog(log)}>
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <AddPeriodLogDialog open={addOpen} onClose={() => setAddOpen(false)} onSave={handleSave} />
    </div>
  );
}

function AddPeriodLogDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
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

  useEffect(() => {
    if (!open) {
      setLogDate(ymd());
      setIsPeriod(false);
      setFlow(null);
      setSymptoms([]);
      setMood("");
      setNotes("");
      setSaving(false);
    }
  }, [open]);

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
    <Dialog open={open} onClose={onClose} title="Log day" description="Track your symptoms and mood.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="p-date">Date</Label>
          <Input id="p-date" type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} required />
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
          <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save log"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function computeCycleInsights(logs: PeriodLog[]): {
  lastPeriodStart: string | null;
  avgCycleDays: number | null;
  predictedNext: string | null;
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
    return { lastPeriodStart: null, avgCycleDays: null, predictedNext: null };
  }
  const lastPeriodStart = firstDays[firstDays.length - 1];
  if (firstDays.length < 2) {
    return { lastPeriodStart, avgCycleDays: null, predictedNext: null };
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
  return { lastPeriodStart, avgCycleDays: avg, predictedNext: ymd(next) };
}
