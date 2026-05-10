import { FormEvent, useEffect, useState } from "react";
import { Plus, Trash2, Dumbbell, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Dialog } from "@/components/ui/Dialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import type { Workout, WorkoutExercise } from "@/types";
import { formatDate, formatTime } from "@/lib/dates";

const WORKOUT_TYPES = ["strength", "cardio", "yoga", "hiit", "mobility", "sports", "other"] as const;

type DraftExercise = {
  name: string;
  sets: string;
  reps: string;
  weight: string;
};

export function GymPage() {
  const { user } = useAuth();
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [exercisesByWorkout, setExercisesByWorkout] = useState<Record<string, WorkoutExercise[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: ws, error: wErr } = await supabase
        .from("workouts")
        .select("*")
        .order("performed_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (wErr) {
        setError(wErr.message);
        setLoading(false);
        return;
      }
      setWorkouts(ws ?? []);

      if (ws && ws.length > 0) {
        const ids = ws.map((w) => w.id);
        const { data: exes, error: eErr } = await supabase
          .from("workout_exercises")
          .select("*")
          .in("workout_id", ids)
          .order("position", { ascending: true });
        if (cancelled) return;
        if (eErr) {
          setError(eErr.message);
        } else {
          const grouped: Record<string, WorkoutExercise[]> = {};
          for (const e of exes ?? []) {
            (grouped[e.workout_id] ??= []).push(e);
          }
          setExercisesByWorkout(grouped);
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function deleteWorkout(w: Workout) {
    if (!confirm(`Delete workout "${w.name}"?`)) return;
    const prev = workouts;
    setWorkouts((ws) => ws.filter((x) => x.id !== w.id));
    const { error } = await supabase.from("workouts").delete().eq("id", w.id);
    if (error) {
      setWorkouts(prev);
      setError(error.message);
    }
  }

  async function handleCreate(input: {
    name: string;
    workout_type: string;
    performed_at: string;
    duration_min: number | null;
    calories: number | null;
    rating: number | null;
    notes: string | null;
    exercises: DraftExercise[];
  }) {
    if (!user) return;
    const { data: created, error: wErr } = await supabase
      .from("workouts")
      .insert({
        user_id: user.id,
        name: input.name,
        workout_type: input.workout_type,
        performed_at: input.performed_at,
        duration_min: input.duration_min,
        calories: input.calories,
        rating: input.rating,
        notes: input.notes,
      })
      .select()
      .single();
    if (wErr || !created) {
      setError(wErr?.message ?? "Failed to create workout");
      return;
    }

    const cleanExercises = input.exercises
      .map((e, i) => ({
        workout_id: created.id,
        user_id: user.id,
        name: e.name.trim(),
        sets: parseIntOrNull(e.sets),
        reps: parseIntOrNull(e.reps),
        weight: parseFloatOrNull(e.weight),
        position: i,
      }))
      .filter((e) => e.name.length > 0);

    let exes: WorkoutExercise[] = [];
    if (cleanExercises.length > 0) {
      const { data: insertedExes, error: eErr } = await supabase
        .from("workout_exercises")
        .insert(cleanExercises)
        .select();
      if (eErr) {
        setError(eErr.message);
      } else {
        exes = insertedExes ?? [];
      }
    }
    setWorkouts((prev) => [created, ...prev]);
    setExercisesByWorkout((prev) => ({ ...prev, [created.id]: exes }));
    setAddOpen(false);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Gym Workout</h1>
          <p className="text-muted-foreground">Log your training sessions and exercises.</p>
        </div>
        <Button onClick={() => setAddOpen(true)} disabled={loading}>
          <Plus className="h-4 w-4" /> Add Workout
        </Button>
      </header>

      {error && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Hevy integration</CardTitle>
          <CardDescription>Sync workouts from your Hevy account.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Connect Hevy in <a href="/settings/integrations" className="text-primary hover:underline">Settings → Integrations</a> to auto-import sessions.
          </p>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : workouts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Dumbbell className="h-10 w-10 mx-auto mb-3 opacity-50" />
            No workouts yet. Click <strong>Add Workout</strong> to log your first session.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {workouts.map((w) => {
            const exes = exercisesByWorkout[w.id] ?? [];
            return (
              <Card key={w.id}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-medium truncate">{w.name}</h3>
                      <p className="text-xs text-muted-foreground capitalize">
                        {w.workout_type} · {formatDate(w.performed_at)} · {formatTime(w.performed_at)}
                      </p>
                      <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                        {w.duration_min != null && <span>{w.duration_min} min</span>}
                        {w.calories != null && <span>{w.calories} kcal</span>}
                        {w.rating != null && (
                          <span className="flex items-center gap-0.5">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star
                                key={i}
                                className={`h-3 w-3 ${i < (w.rating ?? 0) ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground/40"}`}
                              />
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${w.name}`}
                      onClick={() => deleteWorkout(w)}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>

                  {exes.length > 0 && (
                    <ul className="mt-3 space-y-1.5 border-t pt-3">
                      {exes.map((e) => (
                        <li key={e.id} className="text-sm flex items-center justify-between gap-2">
                          <span className="font-medium">{e.name}</span>
                          <span className="text-muted-foreground text-xs">
                            {[e.sets && `${e.sets} sets`, e.reps && `${e.reps} reps`, e.weight && `${e.weight} kg`]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {w.notes && <p className="mt-3 text-sm text-muted-foreground italic">{w.notes}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AddWorkoutDialog open={addOpen} onClose={() => setAddOpen(false)} onCreate={handleCreate} />
    </div>
  );
}

function AddWorkoutDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: {
    name: string;
    workout_type: string;
    performed_at: string;
    duration_min: number | null;
    calories: number | null;
    rating: number | null;
    notes: string | null;
    exercises: DraftExercise[];
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("strength");
  const [performedAt, setPerformedAt] = useState(localDateTimeNow());
  const [durationMin, setDurationMin] = useState("");
  const [calories, setCalories] = useState("");
  const [rating, setRating] = useState("");
  const [notes, setNotes] = useState("");
  const [exercises, setExercises] = useState<DraftExercise[]>([{ name: "", sets: "", reps: "", weight: "" }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setType("strength");
      setPerformedAt(localDateTimeNow());
      setDurationMin("");
      setCalories("");
      setRating("");
      setNotes("");
      setExercises([{ name: "", sets: "", reps: "", weight: "" }]);
      setSaving(false);
    }
  }, [open]);

  function updateExercise(i: number, patch: Partial<DraftExercise>) {
    setExercises((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function addExerciseRow() {
    setExercises((prev) => [...prev, { name: "", sets: "", reps: "", weight: "" }]);
  }
  function removeExerciseRow(i: number) {
    setExercises((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    await onCreate({
      name: name.trim(),
      workout_type: type,
      performed_at: new Date(performedAt).toISOString(),
      duration_min: parseIntOrNull(durationMin),
      calories: parseIntOrNull(calories),
      rating: parseIntOrNull(rating),
      notes: notes.trim() || null,
      exercises,
    });
    setSaving(false);
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add workout" description="Log a training session." className="max-w-2xl">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="w-name">Name</Label>
            <Input id="w-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Push day" maxLength={120} required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="w-type">Type</Label>
            <Select id="w-type" value={type} onChange={(e) => setType(e.target.value)}>
              {WORKOUT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="w-when">When</Label>
            <Input id="w-when" type="datetime-local" value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="w-dur">Duration (min)</Label>
            <Input id="w-dur" type="number" min={0} max={1440} value={durationMin} onChange={(e) => setDurationMin(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="w-cal">Calories</Label>
            <Input id="w-cal" type="number" min={0} max={10000} value={calories} onChange={(e) => setCalories(e.target.value)} />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="w-rate">Rating (1–5)</Label>
            <Select id="w-rate" value={rating} onChange={(e) => setRating(e.target.value)}>
              <option value="">No rating</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{"⭐".repeat(n)}</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-2 border-t pt-4">
          <div className="flex items-center justify-between">
            <Label>Exercises</Label>
            <Button type="button" variant="ghost" size="sm" onClick={addExerciseRow}>
              <Plus className="h-3 w-3" /> Add exercise
            </Button>
          </div>
          <div className="space-y-2">
            {exercises.map((ex, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <Input
                  className="col-span-5"
                  placeholder="Bench press"
                  value={ex.name}
                  onChange={(e) => updateExercise(i, { name: e.target.value })}
                  maxLength={120}
                />
                <Input
                  className="col-span-2"
                  type="number"
                  min={0}
                  placeholder="Sets"
                  value={ex.sets}
                  onChange={(e) => updateExercise(i, { sets: e.target.value })}
                />
                <Input
                  className="col-span-2"
                  type="number"
                  min={0}
                  placeholder="Reps"
                  value={ex.reps}
                  onChange={(e) => updateExercise(i, { reps: e.target.value })}
                />
                <Input
                  className="col-span-2"
                  type="number"
                  min={0}
                  step="0.5"
                  placeholder="kg"
                  value={ex.weight}
                  onChange={(e) => updateExercise(i, { weight: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="col-span-1"
                  aria-label="Remove exercise"
                  onClick={() => removeExerciseRow(i)}
                  disabled={exercises.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="w-notes">Notes</Label>
          <Textarea id="w-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How did it feel?" />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save workout"}</Button>
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

function parseIntOrNull(v: string): number | null {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function parseFloatOrNull(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
