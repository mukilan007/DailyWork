import { useEffect, useMemo, useRef, useState } from "react";
import {
  Timer,
  Play,
  Pause,
  Square,
  Trash2,
  CheckCircle2,
  History,
  Target,
  AlertTriangle,
  ListTodo,
  Tag,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { startOfWeek, ymd, formatTime } from "@/lib/dates";
import type { FocusSession, Todo } from "@/types";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Transient timer state (NOT user data) persisted to localStorage so an
// accidental refresh resumes the countdown. Cleared on completion/abandon.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "daily-rhythm-focus-active";

type ActiveFocus = {
  startedAtIso: string; // recorded start — becomes focus_sessions.started_at
  durationMin: number; // 1..480
  todoId: string | null;
  topic: string | null;
  /** Date.now() at the moment of pause, or null while running. */
  pausedAtMs: number | null;
  /** Total ms spent paused so far (excluding a current pause). */
  pausedTotalMs: number;
};

function loadActive(): ActiveFocus | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<ActiveFocus>;
    if (typeof p.startedAtIso !== "string" || typeof p.durationMin !== "number") return null;
    if (Number.isNaN(new Date(p.startedAtIso).getTime())) return null;
    if (p.durationMin < 1 || p.durationMin > 480) return null;
    return {
      startedAtIso: p.startedAtIso,
      durationMin: Math.round(p.durationMin),
      todoId: typeof p.todoId === "string" ? p.todoId : null,
      topic: typeof p.topic === "string" ? p.topic : null,
      pausedAtMs: typeof p.pausedAtMs === "number" ? p.pausedAtMs : null,
      pausedTotalMs: typeof p.pausedTotalMs === "number" ? p.pausedTotalMs : 0,
    };
  } catch {
    return null;
  }
}

function storeActive(a: ActiveFocus | null): void {
  try {
    if (a) localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode etc.) — timer still works in-memory.
  }
}

// Elapsed *focus* time (wall time minus pauses). Frozen while paused.
function elapsedMs(a: ActiveFocus, now: number): number {
  const start = new Date(a.startedAtIso).getTime();
  const effectiveNow = a.pausedAtMs ?? now;
  return Math.max(0, effectiveNow - start - a.pausedTotalMs);
}

function remainingMs(a: ActiveFocus, now: number): number {
  return a.durationMin * 60_000 - elapsedMs(a, now);
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatMin(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

type CompletedInfo = {
  startedAtIso: string;
  minutes: number;
  todoId: string | null;
  topic: string | null;
  partial: boolean;
};

type SaveState = "saving" | "saved" | "error";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function FocusPage() {
  const { user } = useAuth();

  // Data
  const [todos, setTodos] = useState<Todo[]>([]);
  const [sessions, setSessions] = useState<FocusSession[]>([]); // this week, newest first
  const [recentTopics, setRecentTopics] = useState<string[]>([]);
  const [actualByTodo, setActualByTodo] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Setup form
  const [attachMode, setAttachMode] = useState<"todo" | "topic">("todo");
  const [selectedTodoId, setSelectedTodoId] = useState("");
  const [topicText, setTopicText] = useState("");
  const [durationChoice, setDurationChoice] = useState<"25" | "50" | "custom">("25");
  const [customDuration, setCustomDuration] = useState("");

  // Timer
  const [active, setActive] = useState<ActiveFocus | null>(() => loadActive());
  const [now, setNow] = useState(() => Date.now());
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [completed, setCompleted] = useState<CompletedInfo | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const loggingRef = useRef(false); // double-submit guard for session insert
  // After a session that was attached to a ticket, offer to mark that ticket
  // done. "prompt" = show the suggestion, "marking" = save in flight,
  // "marked" = confirmed. Reset whenever a new completion card appears.
  const [markDoneState, setMarkDoneState] =
    useState<"idle" | "marking" | "marked" | "dismissed">("idle");

  // ---- data fetch ----
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const weekStartIso = startOfWeek().toISOString();
      const [todosRes, weekRes, topicsRes] = await Promise.all([
        supabase.from("todos").select("*").order("created_at", { ascending: false }),
        supabase
          .from("focus_sessions")
          .select("*")
          .gte("started_at", weekStartIso)
          .order("started_at", { ascending: false }),
        supabase
          .from("focus_sessions")
          .select("topic")
          .not("topic", "is", null)
          .order("started_at", { ascending: false })
          .limit(100),
      ]);
      if (cancelled) return;
      const err = todosRes.error ?? weekRes.error ?? topicsRes.error;
      if (err) setError(err.message);
      const allTodos: Todo[] = todosRes.data ?? [];
      setTodos(allTodos);
      setSessions(weekRes.data ?? []);
      const seen = new Set<string>();
      const topics: string[] = [];
      for (const row of (topicsRes.data ?? []) as { topic: string | null }[]) {
        const t = row.topic?.trim();
        if (t && !seen.has(t.toLowerCase())) {
          seen.add(t.toLowerCase());
          topics.push(t);
        }
        if (topics.length >= 10) break;
      }
      setRecentTopics(topics);

      // Estimate-vs-actual: sum ALL sessions for todos that carry an estimate,
      // in a single .in() query.
      const estIds = allTodos.filter((t) => t.estimated_min != null).map((t) => t.id);
      if (estIds.length > 0) {
        const { data: estRows, error: estErr } = await supabase
          .from("focus_sessions")
          .select("todo_id,duration_min")
          .in("todo_id", estIds);
        if (cancelled) return;
        if (estErr) {
          setError(estErr.message);
        } else {
          const sums: Record<string, number> = {};
          for (const r of (estRows ?? []) as { todo_id: string | null; duration_min: number }[]) {
            if (!r.todo_id) continue;
            sums[r.todo_id] = (sums[r.todo_id] ?? 0) + r.duration_min;
          }
          setActualByTodo(sums);
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // ---- persist timer state ----
  useEffect(() => {
    storeActive(active);
  }, [active]);

  // ---- tick: re-render only; remaining time is derived from Date.now()
  // deltas against the recorded start, so tab-throttling can't drift it. ----
  const isRunning = active !== null && active.pausedAtMs === null;
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [isRunning]);

  // ---- completion check (also fires immediately for a restored, expired timer) ----
  useEffect(() => {
    if (!active || active.pausedAtMs !== null) return;
    if (remainingMs(active, now) > 0) return;
    void finishSession(active, active.durationMin, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, now]);

  // ---- session insert (shared by completion, partial log, and retry) ----
  async function insertSession(info: CompletedInfo) {
    if (!user) return;
    setSaveState("saving");
    const { data, error: insErr } = await supabase
      .from("focus_sessions")
      .insert({
        user_id: user.id,
        started_at: info.startedAtIso,
        duration_min: info.minutes,
        todo_id: info.todoId,
        topic: info.topic,
      })
      .select()
      .single();
    if (insErr) {
      // 23505 = unique (user_id, started_at) violation → already logged
      // (e.g. a second tab completed the same restored timer). Treat as saved.
      if (insErr.code === "23505") {
        setSaveState("saved");
      } else {
        setSaveState("error");
        setError(insErr.message);
      }
      return;
    }
    if (data) {
      const row = data as FocusSession;
      setSessions((prev) =>
        prev.some((s) => s.id === row.id) ? prev : [row, ...prev]
      );
      if (row.todo_id) {
        const todoId = row.todo_id;
        setActualByTodo((m) => ({ ...m, [todoId]: (m[todoId] ?? 0) + row.duration_min }));
      }
      if (row.topic) {
        setRecentTopics((prev) => {
          const t = row.topic as string;
          return prev.some((p) => p.toLowerCase() === t.toLowerCase()) ? prev : [t, ...prev];
        });
      }
      setSaveState("saved");
    }
  }

  async function finishSession(a: ActiveFocus, minutes: number, partial: boolean) {
    if (loggingRef.current) return;
    loggingRef.current = true;
    try {
      const info: CompletedInfo = {
        startedAtIso: a.startedAtIso,
        minutes,
        todoId: a.todoId,
        topic: a.topic,
        partial,
      };
      setActive(null);
      storeActive(null);
      setConfirmAbandon(false);
      setCompleted(info);
      setMarkDoneState("idle");
      setError(null);
      await insertSession(info);
    } finally {
      loggingRef.current = false;
    }
  }

  async function retrySave() {
    if (!completed || loggingRef.current) return;
    loggingRef.current = true;
    try {
      await insertSession(completed);
    } finally {
      loggingRef.current = false;
    }
  }

  /** Mark the ticket this session was attached to as done (offered on the
   *  completion card). Optimistic; rolls back on error. */
  async function markCompletedTodoDone(todoId: string) {
    setMarkDoneState("marking");
    const { error: updErr } = await supabase
      .from("todos")
      .update({ is_done: true })
      .eq("id", todoId);
    if (updErr) {
      setMarkDoneState("idle");
      setError(updErr.message);
      return;
    }
    setTodos((list) =>
      list.map((t) => (t.id === todoId ? { ...t, is_done: true } : t))
    );
    setMarkDoneState("marked");
  }

  // ---- timer controls ----
  function handleStart() {
    if (active) return;
    let duration: number;
    if (durationChoice === "custom") {
      const n = Number(customDuration);
      if (!Number.isFinite(n) || n < 1 || n > 480) {
        setError("Custom duration must be 1–480 minutes.");
        return;
      }
      duration = Math.round(n);
    } else {
      duration = durationChoice === "25" ? 25 : 50;
    }
    const todoId = attachMode === "todo" ? selectedTodoId || null : null;
    const topic = attachMode === "topic" ? topicText.trim() || null : null;
    if (!todoId && !topic) {
      setError(
        attachMode === "todo" ? "Pick a ticket to focus on." : "Enter a topic to focus on."
      );
      return;
    }
    setError(null);
    setCompleted(null);
    setActive({
      startedAtIso: new Date().toISOString(),
      durationMin: duration,
      todoId,
      topic,
      pausedAtMs: null,
      pausedTotalMs: 0,
    });
    setNow(Date.now());
  }

  function handlePause() {
    setActive((a) => (a && a.pausedAtMs === null ? { ...a, pausedAtMs: Date.now() } : a));
  }

  function handleResume() {
    setActive((a) =>
      a && a.pausedAtMs !== null
        ? { ...a, pausedTotalMs: a.pausedTotalMs + (Date.now() - a.pausedAtMs), pausedAtMs: null }
        : a
    );
    setNow(Date.now());
  }

  function handleAbandonClick() {
    if (!active) return;
    const elapsedMin = Math.floor(elapsedMs(active, Date.now()) / 60_000);
    if (elapsedMin >= 5) {
      setConfirmAbandon(true);
    } else if (confirm("Discard this focus session?")) {
      discard();
    }
  }

  function discard() {
    setActive(null);
    storeActive(null);
    setConfirmAbandon(false);
  }

  function logPartial() {
    if (!active) return;
    const minutes = Math.min(
      active.durationMin,
      Math.max(1, Math.floor(elapsedMs(active, Date.now()) / 60_000))
    );
    void finishSession(active, minutes, true);
  }

  // ---- history / stats ----
  async function deleteSession(s: FocusSession) {
    if (!confirm("Delete this focus session?")) return;
    const prevSessions = sessions;
    const prevActual = actualByTodo;
    setSessions((list) => list.filter((x) => x.id !== s.id));
    if (s.todo_id && actualByTodo[s.todo_id] != null) {
      const todoId = s.todo_id;
      setActualByTodo((m) => ({ ...m, [todoId]: Math.max(0, (m[todoId] ?? 0) - s.duration_min) }));
    }
    const { error: delErr } = await supabase.from("focus_sessions").delete().eq("id", s.id);
    if (delErr) {
      setSessions(prevSessions);
      setActualByTodo(prevActual);
      setError(delErr.message);
    }
  }

  const todoById = useMemo(() => {
    const m = new Map<string, Todo>();
    for (const t of todos) m.set(t.id, t);
    return m;
  }, [todos]);

  const openTodos = useMemo(() => todos.filter((t) => !t.is_done), [todos]);

  const todayStr = ymd();
  const todaySessions = useMemo(
    () => sessions.filter((s) => ymd(new Date(s.started_at)) === todayStr),
    [sessions, todayStr]
  );
  const todayMin = todaySessions.reduce((sum, s) => sum + s.duration_min, 0);
  const weekMin = sessions.reduce((sum, s) => sum + s.duration_min, 0);

  const estimateRows = useMemo(
    () =>
      todos
        .filter((t) => t.estimated_min != null && (actualByTodo[t.id] ?? 0) > 0)
        .map((t) => ({
          todo: t,
          estimated: t.estimated_min as number,
          actual: actualByTodo[t.id] ?? 0,
        }))
        .sort((a, b) => b.actual / b.estimated - a.actual / a.estimated),
    [todos, actualByTodo]
  );

  function sessionLabel(s: FocusSession): string {
    if (s.todo_id) return todoById.get(s.todo_id)?.title ?? "Deleted ticket";
    return s.topic ?? "Focus";
  }

  const remaining = active ? remainingMs(active, now) : 0;
  const progress = active
    ? Math.min(1, elapsedMs(active, now) / (active.durationMin * 60_000))
    : 0;
  const elapsedMinNow = active ? Math.floor(elapsedMs(active, now) / 60_000) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Focus"
        icon={<Timer className="h-5 w-5" />}
        description={
          weekMin > 0
            ? `${formatMin(todayMin)} focused today · ${formatMin(weekMin)} this week`
            : "Run a focus timer against a ticket or topic."
        }
      />

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* ---- Timer / setup / complete card ---- */}
      {active ? (
        <Card className="border-primary/40">
          <CardContent className="p-6 flex flex-col items-center gap-4">
            <div className="text-sm text-muted-foreground text-center">
              {active.todoId ? (
                <span className="inline-flex items-center gap-1.5">
                  <ListTodo className="h-3.5 w-3.5" />
                  {todoById.get(active.todoId)?.title ?? "Ticket"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5" />
                  {active.topic}
                </span>
              )}
              <span className="mx-1.5">·</span>
              {active.durationMin} min session
            </div>

            <div
              className={cn(
                "text-6xl sm:text-7xl font-semibold tabular-nums tracking-tight",
                active.pausedAtMs !== null && "text-muted-foreground"
              )}
              aria-live="polite"
            >
              {formatClock(remaining)}
            </div>

            <div className="w-full max-w-sm h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-[width] duration-500"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>

            {active.pausedAtMs !== null && (
              <Badge variant="warning">
                <Pause className="h-3 w-3" /> Paused
              </Badge>
            )}

            {confirmAbandon ? (
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm text-muted-foreground">
                  You focused for {elapsedMinNow} min — log it as a partial session?
                </p>
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  <Button type="button" size="sm" onClick={logPartial}>
                    Log partial session ({Math.min(active.durationMin, Math.max(1, elapsedMinNow))}m)
                  </Button>
                  <Button type="button" size="sm" variant="destructive" onClick={discard}>
                    Discard
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmAbandon(false)}
                  >
                    Keep going
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {active.pausedAtMs === null ? (
                  <Button type="button" variant="outline" onClick={handlePause}>
                    <Pause className="h-4 w-4" /> Pause
                  </Button>
                ) : (
                  <Button type="button" onClick={handleResume}>
                    <Play className="h-4 w-4" /> Resume
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={handleAbandonClick}
                >
                  <Square className="h-4 w-4" /> Abandon
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : completed ? (
        <Card className="border-primary/40">
          <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="h-10 w-10 text-primary" />
            <div>
              <h2 className="text-lg font-semibold">
                {completed.partial ? "Partial session logged" : "Session complete"}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {formatMin(completed.minutes)} on{" "}
                {completed.todoId
                  ? todoById.get(completed.todoId)?.title ?? "a ticket"
                  : completed.topic ?? "focus"}
              </p>
            </div>
            {saveState === "saving" && (
              <p className="text-xs text-muted-foreground">Saving…</p>
            )}
            {saveState === "error" && (
              <div className="flex items-center gap-2">
                <p className="text-xs text-destructive">Couldn’t save this session.</p>
                <Button type="button" size="sm" variant="outline" onClick={() => void retrySave()}>
                  Retry save
                </Button>
              </div>
            )}

            {/* Suggestion: mark the attached ticket done. Only when the session
                was tied to a still-open ticket. */}
            {(() => {
              if (!completed.todoId) return null;
              const t = todoById.get(completed.todoId);
              if (!t) return null;
              if (markDoneState === "marked" || t.is_done) {
                return (
                  <p className="inline-flex items-center gap-1.5 text-sm text-emerald-500">
                    <CheckCircle2 className="h-4 w-4" />
                    Marked “{t.title}” as done
                  </p>
                );
              }
              if (markDoneState === "dismissed") return null;
              return (
                <div className="w-full max-w-sm rounded-md border border-primary/30 bg-primary/5 p-3 flex flex-col items-center gap-2">
                  <p className="text-sm font-medium">Finished this ticket?</p>
                  <p className="text-xs text-muted-foreground text-center truncate max-w-full">
                    {t.title}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={markDoneState === "marking"}
                      onClick={() => void markCompletedTodoDone(t.id)}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {markDoneState === "marking" ? "Marking…" : "Mark done"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setMarkDoneState("dismissed")}
                    >
                      Not yet
                    </Button>
                  </div>
                </div>
              );
            })()}

            <Button
              type="button"
              variant="outline"
              disabled={saveState === "saving"}
              onClick={() => setCompleted(null)}
            >
              Start another
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2" role="tablist" aria-label="Attach session to">
              {(
                [
                  { key: "todo", label: "Ticket", icon: <ListTodo className="h-3.5 w-3.5" /> },
                  { key: "topic", label: "Topic", icon: <Tag className="h-3.5 w-3.5" /> },
                ] as const
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="tab"
                  aria-selected={attachMode === m.key}
                  onClick={() => setAttachMode(m.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-all active:scale-95",
                    attachMode === m.key
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "border-input hover:bg-accent hover:border-accent-foreground/20"
                  )}
                >
                  {m.icon}
                  {m.label}
                </button>
              ))}
            </div>

            {attachMode === "todo" ? (
              <div className="space-y-1.5">
                <Label htmlFor="focus-todo">Open ticket</Label>
                <Select
                  id="focus-todo"
                  value={selectedTodoId}
                  onChange={(e) => setSelectedTodoId(e.target.value)}
                  disabled={loading || openTodos.length === 0}
                >
                  <option value="">
                    {loading
                      ? "Loading tickets…"
                      : openTodos.length === 0
                      ? "No open tickets"
                      : "Pick a ticket…"}
                  </option>
                  {openTodos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                      {t.estimated_min != null ? ` (est ${formatMin(t.estimated_min)})` : ""}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="focus-topic">Topic</Label>
                <Input
                  id="focus-topic"
                  value={topicText}
                  onChange={(e) => setTopicText(e.target.value)}
                  placeholder="e.g. System design reading"
                  maxLength={120}
                  list="focus-topic-suggestions"
                />
                <datalist id="focus-topic-suggestions">
                  {recentTopics.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Duration</Label>
              <div className="flex items-center gap-2 flex-wrap">
                {(["25", "50"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDurationChoice(d)}
                    className={cn(
                      "text-sm px-4 py-1.5 rounded-full border tabular-nums transition-all active:scale-95",
                      durationChoice === d
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "border-input hover:bg-accent"
                    )}
                  >
                    {d} min
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDurationChoice("custom")}
                  className={cn(
                    "text-sm px-4 py-1.5 rounded-full border transition-all active:scale-95",
                    durationChoice === "custom"
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "border-input hover:bg-accent"
                  )}
                >
                  Custom
                </button>
                {durationChoice === "custom" && (
                  <Input
                    type="number"
                    min={1}
                    max={480}
                    inputMode="numeric"
                    value={customDuration}
                    onChange={(e) => setCustomDuration(e.target.value)}
                    placeholder="min"
                    aria-label="Custom duration in minutes"
                    className="w-24 h-9"
                  />
                )}
              </div>
            </div>

            <Button type="button" onClick={handleStart} className="w-full sm:w-auto">
              <Play className="h-4 w-4" /> Start focus
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ---- Estimate vs actual ---- */}
      {estimateRows.length > 0 && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Estimate vs actual</h3>
            </div>
            <ul className="space-y-2">
              {estimateRows.map(({ todo, estimated, actual }) => {
                const overrun = actual > estimated * 1.5;
                return (
                  <li
                    key={todo.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span
                      className={cn(
                        "truncate min-w-0",
                        todo.is_done && "line-through text-muted-foreground"
                      )}
                    >
                      {todo.title}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 tabular-nums inline-flex items-center gap-1.5",
                        overrun ? "text-rose-600 dark:text-rose-400 font-medium" : "text-muted-foreground"
                      )}
                    >
                      {overrun && <AlertTriangle className="h-3.5 w-3.5" />}
                      est {formatMin(estimated)} / actual {formatMin(actual)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ---- History ---- */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between px-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" /> This week
          </h3>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            today {formatMin(todayMin)} · week {formatMin(weekMin)}
          </span>
        </div>

        {loading ? (
          <SkeletonList rows={2} />
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={<Timer className="h-7 w-7" />}
            title="No focus sessions yet"
            description="Sessions you complete this week will show up here."
          />
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => {
              const isToday = ymd(new Date(s.started_at)) === todayStr;
              return (
                <li key={s.id}>
                  <Card className="group">
                    <CardContent className="p-3 flex items-center gap-3">
                      <Badge variant={isToday ? "info" : "secondary"} className="shrink-0 tabular-nums">
                        {formatMin(s.duration_min)}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{sessionLabel(s)}</p>
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          {isToday
                            ? `Today ${formatTime(s.started_at)}`
                            : `${new Date(s.started_at).toLocaleDateString([], {
                                weekday: "short",
                              })} ${formatTime(s.started_at)}`}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:text-destructive"
                        aria-label="Delete session"
                        onClick={() => void deleteSession(s)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
