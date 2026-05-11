import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  ListTodo,
  Pencil,
  Eraser,
  Clock,
  Flag,
  AlertCircle,
  CalendarClock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
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
import { SkeletonList } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { formatRelative } from "@/lib/dates";
import { exportReport } from "@/lib/export";
import type { Todo, TodoPriority } from "@/types";
import { cn } from "@/lib/utils";

type Filter = "all" | "active" | "done";

const PRIORITIES: { value: TodoPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const PRIORITY_RANK: Record<TodoPriority, number> = { high: 0, medium: 1, low: 2 };

export function TodosPage() {
  const { user } = useAuth();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Todo | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("todos")
        .select("*")
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) setError(error.message);
      else setTodos(data ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handleSave(input: TicketDraft) {
    if (!user) return;
    setError(null);
    if (editing) {
      const patch = {
        title: input.title,
        description: input.description,
        priority: input.priority,
        due_at: input.due_at,
        estimated_min: input.estimated_min,
      };
      // Optimistic patch so the dialog can close immediately.
      const prev = todos;
      setTodos((ts) => ts.map((t) => (t.id === editing.id ? { ...t, ...patch } : t)));
      setDialogOpen(false);
      setEditing(null);
      const { data, error } = await supabase
        .from("todos")
        .update(patch)
        .eq("id", editing.id)
        .select()
        .single();
      if (error) {
        setTodos(prev);
        setError(error.message);
      } else if (data) {
        setTodos((ts) => ts.map((t) => (t.id === data.id ? data : t)));
      }
    } else {
      const { data, error } = await supabase
        .from("todos")
        .insert({
          user_id: user.id,
          title: input.title,
          description: input.description,
          priority: input.priority,
          due_at: input.due_at,
          estimated_min: input.estimated_min,
        })
        .select()
        .single();
      if (error) {
        setError(error.message);
        return;
      }
      if (data) {
        setTodos((prev) => [data, ...prev]);
        setDialogOpen(false);
      }
    }
  }

  async function toggleDone(todo: Todo) {
    const next = !todo.is_done;
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, is_done: next } : t)));
    const { error } = await supabase.from("todos").update({ is_done: next }).eq("id", todo.id);
    if (error) {
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, is_done: !next } : t)));
      setError(error.message);
    }
  }

  async function deleteTodo(todo: Todo) {
    if (!confirm(`Delete ticket "${todo.title}"?`)) return;
    const prev = todos;
    setTodos((ts) => ts.filter((t) => t.id !== todo.id));
    const { error } = await supabase.from("todos").delete().eq("id", todo.id);
    if (error) {
      setTodos(prev);
      setError(error.message);
    }
  }

  function startEdit(todo: Todo) {
    setEditing(todo);
    setDialogOpen(true);
  }

  function startAdd() {
    setEditing(null);
    setDialogOpen(true);
  }

  async function clearCompleted() {
    const doneIds = todos.filter((t) => t.is_done).map((t) => t.id);
    if (doneIds.length === 0) return;
    if (!confirm(`Delete ${doneIds.length} completed ticket${doneIds.length === 1 ? "" : "s"}?`)) return;
    const prev = todos;
    setTodos((ts) => ts.filter((t) => !t.is_done));
    const { error } = await supabase.from("todos").delete().in("id", doneIds);
    if (error) {
      setTodos(prev);
      setError(error.message);
    }
  }

  const counts = useMemo(
    () => ({
      all: todos.length,
      active: todos.filter((t) => !t.is_done).length,
      done: todos.filter((t) => t.is_done).length,
      overdue: todos.filter((t) => !t.is_done && isOverdue(t.due_at)).length,
    }),
    [todos]
  );

  const visible = useMemo(
    () =>
      todos.filter((t) =>
        filter === "active" ? !t.is_done : filter === "done" ? t.is_done : true
      ),
    [todos, filter]
  );

  /** Active tickets: sort by overdue first, then priority, then due date, then creation. */
  const sortedActive = useMemo(() => {
    return visible
      .filter((t) => !t.is_done)
      .slice()
      .sort((a, b) => {
        const aOver = isOverdue(a.due_at) ? 0 : 1;
        const bOver = isOverdue(b.due_at) ? 0 : 1;
        if (aOver !== bOver) return aOver - bOver;
        const pri = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (pri !== 0) return pri;
        const aDue = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
        const bDue = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
        if (aDue !== bDue) return aDue - bDue;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [visible]);

  const sortedDone = useMemo(
    () =>
      visible
        .filter((t) => t.is_done)
        .slice()
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [visible]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tickets"
        icon={<ListTodo className="h-5 w-5" />}
        description={
          counts.all === 0
            ? "Track work as tickets with priority and due times."
            : counts.active === 0
            ? "All clear — nothing left."
            : counts.overdue > 0
            ? `${counts.active} open · ${counts.overdue} overdue`
            : `${counts.active} of ${counts.all} remaining.`
        }
        actions={
          <div className="flex items-center gap-2">
            <ExportButton
              disabled={loading || todos.length === 0}
              onExport={(format) =>
                exportReport({
                  name: "tickets",
                  format,
                  rows: todos.map((t) => ({
                    id: t.id,
                    title: t.title,
                    description: t.description ?? "",
                    status: t.is_done ? "done" : "active",
                    priority: t.priority,
                    due_at: t.due_at ?? "",
                    estimated_min: t.estimated_min ?? "",
                    created_at: t.created_at,
                  })),
                  columns: [
                    "id", "title", "description", "status", "priority",
                    "due_at", "estimated_min", "created_at",
                  ],
                  meta: { source: "todos" },
                })
              }
            />
            <Button onClick={startAdd} disabled={loading}>
              <Plus className="h-4 w-4" /> Add Ticket
            </Button>
          </div>
        }
      />

      {counts.all > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatTile label="Total" value={counts.all} />
          <StatTile label="Active" value={counts.active} accent="primary" />
          <StatTile label="Overdue" value={counts.overdue} accent={counts.overdue > 0 ? "danger" : "muted"} />
          <StatTile label="Done" value={counts.done} accent="muted" />
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2" role="tablist" aria-label="Filter tickets">
          {(["all", "active", "done"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border capitalize transition-all active:scale-95",
                filter === f
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "border-input hover:bg-accent hover:border-accent-foreground/20"
              )}
            >
              <span>{f}</span>
              <span
                className={cn(
                  "tabular-nums text-[10px] rounded-full px-1.5 py-0 leading-relaxed",
                  filter === f ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"
                )}
              >
                {counts[f]}
              </span>
            </button>
          ))}
        </div>
        {counts.done > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-destructive"
            onClick={clearCompleted}
          >
            <Eraser className="h-3.5 w-3.5" /> Clear completed
          </Button>
        )}
      </div>

      {loading ? (
        <SkeletonList rows={3} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<ListTodo className="h-7 w-7" />}
          title={counts.all === 0 ? "No tickets yet" : `No ${filter} tickets`}
          description={
            counts.all === 0
              ? "Open a ticket to capture work with a due time, priority, and notes."
              : `Nothing in this view — try another filter.`
          }
        />
      ) : (
        <div className="space-y-5">
          {filter !== "done" && sortedActive.length > 0 && (
            <Section label="Active" count={sortedActive.length}>
              <ul className="space-y-2">
                {sortedActive.map((t) => (
                  <TicketCard
                    key={t.id}
                    todo={t}
                    onToggle={toggleDone}
                    onEdit={startEdit}
                    onDelete={deleteTodo}
                  />
                ))}
              </ul>
            </Section>
          )}
          {filter !== "active" && sortedDone.length > 0 && (
            <Section label="Done" count={sortedDone.length} dimmed>
              <ul className="space-y-2">
                {sortedDone.map((t) => (
                  <TicketCard
                    key={t.id}
                    todo={t}
                    onToggle={toggleDone}
                    onEdit={startEdit}
                    onDelete={deleteTodo}
                  />
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}

      <TicketDialog
        open={dialogOpen}
        editing={editing}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />
    </div>
  );
}

// ---------- helpers ----------

function isOverdue(dueAt: string | null): boolean {
  if (!dueAt) return false;
  return new Date(dueAt).getTime() < Date.now();
}

function isToday(dueAt: string | null): boolean {
  if (!dueAt) return false;
  const d = new Date(dueAt);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** "Due in 2h", "Overdue 1d", "Tomorrow 3:00 PM", "Mar 12, 9:00 AM" */
function formatDueLabel(dueAt: string): string {
  const due = new Date(dueAt);
  const diffMs = due.getTime() - Date.now();
  const absMin = Math.abs(Math.round(diffMs / 60000));
  const sign = diffMs < 0 ? "Overdue" : "in";
  let amount: string;
  if (absMin < 60) amount = `${absMin}m`;
  else if (absMin < 60 * 24) amount = `${Math.round(absMin / 60)}h`;
  else amount = `${Math.round(absMin / (60 * 24))}d`;
  if (sign === "Overdue") return `Overdue ${amount}`;
  if (isToday(dueAt)) {
    return `Today ${due.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  if (absMin < 60 * 24 * 2 && diffMs > 0) {
    return `Tomorrow ${due.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  return due.toLocaleDateString([], { month: "short", day: "numeric" }) +
    `, ${due.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function priorityBadgeVariant(p: TodoPriority): "destructive" | "warning" | "secondary" {
  if (p === "high") return "destructive";
  if (p === "medium") return "warning";
  return "secondary";
}

function formatEstimate(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Convert a Date input value (YYYY-MM-DDTHH:mm in local time) <-> ISO string.
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function localInputToIso(input: string): string | null {
  if (!input) return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// ---------- ticket card ----------

interface TicketCardProps {
  todo: Todo;
  onToggle: (t: Todo) => void;
  onEdit: (t: Todo) => void;
  onDelete: (t: Todo) => void;
}

function TicketCard({ todo, onToggle, onEdit, onDelete }: TicketCardProps) {
  const overdue = !todo.is_done && isOverdue(todo.due_at);
  const dueToday = !todo.is_done && isToday(todo.due_at);
  const accentClass = todo.is_done
    ? "border-l-muted-foreground/30"
    : overdue
    ? "border-l-rose-500"
    : dueToday
    ? "border-l-amber-500"
    : todo.priority === "high"
    ? "border-l-rose-400"
    : todo.priority === "medium"
    ? "border-l-amber-400"
    : "border-l-muted-foreground/40";

  return (
    <li>
      <Card className={cn("group transition-shadow hover:shadow-sm border-l-4", accentClass)}>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => onToggle(todo)}
              aria-pressed={todo.is_done}
              aria-label={todo.is_done ? "Mark as not done" : "Mark as done"}
              className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary transition-colors active:scale-90"
            >
              {todo.is_done ? (
                <CheckCircle2 className="h-5 w-5 text-primary" />
              ) : (
                <Circle className="h-5 w-5" />
              )}
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <h3
                  className={cn(
                    "text-sm font-medium leading-snug",
                    todo.is_done && "line-through text-muted-foreground"
                  )}
                >
                  {todo.title}
                </h3>
                <div className="flex items-center gap-1 shrink-0 -mt-1 -mr-1">
                  {!todo.is_done && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                      aria-label={`Edit ${todo.title}`}
                      onClick={() => onEdit(todo)}
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:text-destructive"
                    aria-label={`Delete ${todo.title}`}
                    onClick={() => onDelete(todo)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {todo.description && (
                <p
                  className={cn(
                    "mt-1 text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap",
                    todo.is_done && "line-through"
                  )}
                >
                  {todo.description}
                </p>
              )}

              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <Badge variant={priorityBadgeVariant(todo.priority)}>
                  <Flag className="h-3 w-3" />
                  {todo.priority}
                </Badge>
                {todo.due_at && (
                  <Badge
                    variant={
                      overdue
                        ? "destructive"
                        : dueToday
                        ? "warning"
                        : "info"
                    }
                  >
                    {overdue ? (
                      <AlertCircle className="h-3 w-3" />
                    ) : (
                      <CalendarClock className="h-3 w-3" />
                    )}
                    {formatDueLabel(todo.due_at)}
                  </Badge>
                )}
                {todo.estimated_min != null && (
                  <Badge variant="outline">
                    <Clock className="h-3 w-3" />
                    {formatEstimate(todo.estimated_min)}
                  </Badge>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                  {formatRelative(todo.created_at)}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

// ---------- section ----------

function Section({
  label,
  count,
  dimmed,
  children,
}: {
  label: string;
  count: number;
  dimmed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(dimmed && "opacity-70")}>
      <div className="flex items-baseline justify-between mb-2 px-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </h3>
        <span className="text-[11px] text-muted-foreground tabular-nums">{count}</span>
      </div>
      {children}
    </div>
  );
}

// ---------- stat tile ----------

function StatTile({
  label,
  value,
  accent = "default",
}: {
  label: string;
  value: number;
  accent?: "default" | "primary" | "muted" | "danger";
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div
          className={cn(
            "text-2xl font-semibold tabular-nums leading-tight mt-0.5",
            accent === "primary" && "text-primary",
            accent === "muted" && "text-muted-foreground",
            accent === "danger" && "text-rose-600 dark:text-rose-400"
          )}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- add / edit dialog ----------

type TicketDraft = {
  title: string;
  description: string | null;
  priority: TodoPriority;
  due_at: string | null;
  estimated_min: number | null;
};

interface TicketDialogProps {
  open: boolean;
  editing: Todo | null;
  onClose: () => void;
  onSave: (draft: TicketDraft) => Promise<void> | void;
}

function TicketDialog({ open, editing, onClose, onSave }: TicketDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TodoPriority>("medium");
  const [dueLocal, setDueLocal] = useState(""); // datetime-local string
  const [estimate, setEstimate] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setTitle(editing.title);
      setDescription(editing.description ?? "");
      setPriority(editing.priority);
      setDueLocal(isoToLocalInput(editing.due_at));
      setEstimate(editing.estimated_min == null ? "" : String(editing.estimated_min));
    } else {
      setTitle("");
      setDescription("");
      setPriority("medium");
      setDueLocal("");
      setEstimate("");
    }
    setErr(null);
  }, [open, editing]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setErr("Title is required.");
      return;
    }
    let estMin: number | null = null;
    if (estimate.trim()) {
      const n = Number(estimate);
      if (!Number.isFinite(n) || n <= 0 || n > 1440) {
        setErr("Estimate must be 1–1440 minutes.");
        return;
      }
      estMin = Math.round(n);
    }
    setSaving(true);
    setErr(null);
    try {
      await onSave({
        title: trimmedTitle,
        description: description.trim() ? description.trim() : null,
        priority,
        due_at: localInputToIso(dueLocal),
        estimated_min: estMin,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Edit ticket" : "New ticket"}
      description={
        editing
          ? "Update the ticket — changes save immediately."
          : "Capture work with a priority and optional due time."
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ticket-title">Title</Label>
          <Input
            id="ticket-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            maxLength={200}
            autoFocus
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ticket-desc">Description (optional)</Label>
          <Textarea
            id="ticket-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes, acceptance criteria, links…"
            maxLength={2000}
            rows={3}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ticket-priority">Priority</Label>
            <Select
              id="ticket-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TodoPriority)}
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ticket-estimate">Estimate (min, optional)</Label>
            <Input
              id="ticket-estimate"
              type="number"
              min={1}
              max={1440}
              step={5}
              inputMode="numeric"
              value={estimate}
              onChange={(e) => setEstimate(e.target.value)}
              placeholder="e.g. 30"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ticket-due">Due (optional)</Label>
          <Input
            id="ticket-due"
            type="datetime-local"
            value={dueLocal}
            onChange={(e) => setDueLocal(e.target.value)}
          />
          {dueLocal && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDueLocal("")}
                className="text-[11px] px-2 py-0.5 rounded-full border border-input text-muted-foreground hover:bg-accent"
              >
                Clear due time
              </button>
            </div>
          )}
        </div>

        {err && (
          <p role="alert" className="text-sm text-destructive">
            {err}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !title.trim()}>
            {saving ? "Saving…" : editing ? "Save changes" : "Create ticket"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
