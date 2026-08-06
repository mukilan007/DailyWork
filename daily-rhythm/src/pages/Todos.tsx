import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
  ArrowLeft,
  CalendarClock,
  Repeat,
  Settings,
  ChevronDown,
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
import { formatRelative, ymd } from "@/lib/dates";
import { DateField } from "@/components/ui/DateField";
import { exportReport } from "@/lib/export";
import {
  createTodoRecurrence,
  deleteTodoRecurrence,
  listTodoRecurrences,
  materialiseDueTodoRecurrences,
  occurrenceDueAtIso,
  recurrenceLabel,
  DEFAULT_DUE_TIME,
} from "@/lib/todo-recur";
import type {
  Frequency,
  Todo,
  TodoPriority,
  TodoRecurrence,
  TodoRecurrenceTemplate,
  TodoSpace,
} from "@/types";
import { cn } from "@/lib/utils";
import {
  INBOX_CONFIG,
  spaceConfig,
  statusIsDone,
  findStatus,
  findCategory,
  DEFAULT_STATUS_KEY,
  type SpaceConfig,
} from "@/lib/todo-config";

type Filter = "all" | "active" | "done";

const PRIORITIES: { value: TodoPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const PRIORITY_RANK: Record<TodoPriority, number> = { high: 0, medium: 1, low: 2 };

export function TodosPage() {
  const { user } = useAuth();
  const { spaceId } = useParams();
  // "inbox" is the space-less bucket (space_id IS NULL). Any other value is a
  // real space id we scope every query, insert, and recurrence to.
  const isInbox = spaceId === "inbox";
  const effectiveSpaceId = isInbox ? null : spaceId ?? null;

  const [todos, setTodos] = useState<Todo[]>([]);
  const [space, setSpace] = useState<TodoSpace | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  // Multi-select filters — empty array = show all.
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  // Task-date range filter (YYYY-MM-DD); empty = unbounded on that side.
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [repeatsOpen, setRepeatsOpen] = useState(false);

  // Resolved per-space schema. Inbox has no config row → sensible defaults
  // (no categories, default statuses, no custom fields).
  const config: SpaceConfig = useMemo(
    () => (isInbox ? INBOX_CONFIG : spaceConfig(space)),
    [isInbox, space]
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setNotFound(false);
      // Validate a real space up-front so we can title the page and show a
      // "not found" state for stale/deleted links. RLS scopes it to the user.
      if (!isInbox && effectiveSpaceId) {
        const { data: sp, error: spErr } = await supabase
          .from("todo_spaces")
          .select("*")
          .eq("id", effectiveSpaceId)
          .maybeSingle();
        if (cancelled) return;
        if (spErr) {
          setError(spErr.message);
          setLoading(false);
          return;
        }
        if (!sp) {
          setNotFound(true);
          setSpace(null);
          setLoading(false);
          return;
        }
        setSpace(sp as TodoSpace);
      } else {
        setSpace(null);
      }
      // Materialise due recurrences once per mount (mirrors
      // FinanceTransactions) — before the select so today's generated
      // occurrences appear in this load. It runs globally; each generated
      // todo carries its recurrence's space_id, so the scoped fetch below
      // naturally surfaces only this space's due todos. Idempotent under
      // StrictMode double-effects via the (recurrence_id, recurrence_due_on) index.
      await materialiseDueTodoRecurrences(supabase, user.id);
      const base = supabase
        .from("todos")
        .select("*")
        .order("created_at", { ascending: false });
      const scoped = isInbox
        ? base.is("space_id", null)
        : base.eq("space_id", effectiveSpaceId);
      const { data, error } = await scoped;
      if (cancelled) return;
      if (error) setError(error.message);
      else setTodos(data ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, spaceId, isInbox, effectiveSpaceId]);

  async function handleSave(input: TicketDraft) {
    if (!user) return;
    setError(null);
    // is_done stays in sync with status on every write (insert + edit) so the
    // agenda / dashboard / weekly-review, which read is_done, stay correct.
    const nextIsDone = statusIsDone(input.status, config.statuses);
    if (editing) {
      // Note: recurrence_id / recurrence_due_on are intentionally NOT in the
      // patch — editing a materialised todo must preserve its repeat link.
      const patch = {
        title: input.title,
        description: input.description,
        priority: input.priority,
        due_at: input.due_at,
        estimated_min: input.estimated_min,
        task_date: input.task_date,
        category: input.category,
        status: input.status,
        is_done: nextIsDone,
        tags: input.tags,
        custom: input.custom,
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
      // Optional recurrence: create the schedule row first, then insert the
      // first occurrence linked to it so it appears immediately.
      let recurrenceId: string | null = null;
      let recurrenceDueOn: string | null = null;
      let dueAt = input.due_at;
      if (input.recurrence) {
        const firstDue = input.due_at ? new Date(input.due_at) : new Date();
        const occurrence = ymd(firstDue);
        const pad = (n: number) => String(n).padStart(2, "0");
        const dueTime = input.due_at
          ? `${pad(firstDue.getHours())}:${pad(firstDue.getMinutes())}`
          : DEFAULT_DUE_TIME;
        if (!dueAt) dueAt = occurrenceDueAtIso(occurrence, dueTime);
        const template: TodoRecurrenceTemplate = {
          title: input.title,
          description: input.description,
          priority: input.priority,
          estimated_min: input.estimated_min,
          due_time: dueTime,
        };
        try {
          const rec = await createTodoRecurrence(supabase, user.id, {
            template_json: template,
            frequency: input.recurrence.frequency,
            interval_n: input.recurrence.interval_n,
            start_on: occurrence,
            end_on: input.recurrence.end_on,
            // The first occurrence is inserted right below — anchor the
            // materialiser past it so it isn't regenerated.
            last_materialised_on: occurrence,
            // Future occurrences land in this space too.
            space_id: effectiveSpaceId,
          });
          recurrenceId = rec.id;
          recurrenceDueOn = occurrence;
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          return;
        }
      }
      const { data, error } = await supabase
        .from("todos")
        .insert({
          user_id: user.id,
          title: input.title,
          description: input.description,
          priority: input.priority,
          due_at: dueAt,
          estimated_min: input.estimated_min,
          task_date: input.task_date,
          recurrence_id: recurrenceId,
          recurrence_due_on: recurrenceDueOn,
          space_id: effectiveSpaceId,
          category: input.category,
          status: input.status,
          is_done: nextIsDone,
          tags: input.tags,
          custom: input.custom,
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
    // Keep status in step with the checkbox: pick a "done" status when
    // checking and an open one when unchecking, falling back to the canonical
    // 'done'/'todo' keys so is_done and status never drift.
    const doneStatus = config.statuses.find((s) => statusIsDone(s.key, config.statuses));
    const openStatus = config.statuses.find((s) => !statusIsDone(s.key, config.statuses));
    const nextStatus = next
      ? doneStatus?.key ?? "done"
      : openStatus?.key ?? DEFAULT_STATUS_KEY;
    const prevStatus = todo.status;
    setTodos((prev) =>
      prev.map((t) => (t.id === todo.id ? { ...t, is_done: next, status: nextStatus } : t))
    );
    const { error } = await supabase
      .from("todos")
      .update({ is_done: next, status: nextStatus })
      .eq("id", todo.id);
    if (error) {
      setTodos((prev) =>
        prev.map((t) =>
          t.id === todo.id ? { ...t, is_done: !next, status: prevStatus } : t
        )
      );
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
      todos.filter((t) => {
        const passDone =
          filter === "active" ? !t.is_done : filter === "done" ? t.is_done : true;
        const passCategory =
          categoryFilter.length === 0 || categoryFilter.includes(t.category ?? "");
        const passStatus =
          statusFilter.length === 0 ||
          statusFilter.includes(t.status ?? DEFAULT_STATUS_KEY);
        // Filter by task date, falling back to the created date for older
        // tickets that predate the task_date field.
        const effectiveDate = t.task_date ?? ymd(new Date(t.created_at));
        const passRange =
          (!rangeFrom || effectiveDate >= rangeFrom) &&
          (!rangeTo || effectiveDate <= rangeTo);
        return passDone && passCategory && passStatus && passRange;
      }),
    [todos, filter, categoryFilter, statusFilter, rangeFrom, rangeTo]
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

  if (notFound) {
    return (
      <div className="space-y-4">
        <Link
          to="/todos"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to spaces
        </Link>
        <EmptyState
          icon={<ListTodo className="h-7 w-7" />}
          title="Space not found"
          description="This space may have been deleted. Its tickets, if any, were moved to the Inbox."
          action={
            <Link to="/todos">
              <Button>Back to spaces</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const pageTitle = isInbox ? "Inbox" : space?.name ?? "Tickets";

  return (
    <div className="space-y-6">
      <Link
        to="/todos"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to spaces
      </Link>
      <PageHeader
        title={pageTitle}
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
            <Button
              type="button"
              variant="outline"
              onClick={() => setRepeatsOpen(true)}
              disabled={loading}
              title="Manage repeating tickets"
            >
              <Repeat className="h-4 w-4" /> Repeats
            </Button>
            {!isInbox && effectiveSpaceId && (
              <Link to={`/todos/${effectiveSpaceId}/settings`}>
                <Button type="button" variant="outline" title="Space settings">
                  <Settings className="h-4 w-4" /> Settings
                </Button>
              </Link>
            )}
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
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <input
              type="date"
              aria-label="From date"
              value={rangeFrom}
              max={rangeTo || undefined}
              onChange={(e) => setRangeFrom(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs [color-scheme:dark] cursor-pointer"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <input
              type="date"
              aria-label="To date"
              value={rangeTo}
              min={rangeFrom || undefined}
              onChange={(e) => setRangeTo(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs [color-scheme:dark] cursor-pointer"
            />
            {(rangeFrom || rangeTo) && (
              <button
                type="button"
                onClick={() => {
                  setRangeFrom("");
                  setRangeTo("");
                }}
                className="text-xs text-primary hover:underline px-1"
              >
                Clear
              </button>
            )}
          </div>
          {config.categories.length > 0 && (
            <MultiSelectFilter
              label="categories"
              options={config.categories.map((c) => ({
                key: c.key,
                label: c.label,
                color: c.color,
              }))}
              selected={categoryFilter}
              onChange={setCategoryFilter}
            />
          )}
          <MultiSelectFilter
            label="statuses"
            options={config.statuses.map((s) => ({
              key: s.key,
              label: s.label,
              color: s.color,
            }))}
            selected={statusFilter}
            onChange={setStatusFilter}
          />
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
                    config={config}
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
                    config={config}
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
        config={config}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />

      <ManageRepeatsDialog
        open={repeatsOpen}
        isInbox={isInbox}
        spaceId={effectiveSpaceId}
        onClose={() => setRepeatsOpen(false)}
        onDeleted={(id) =>
          // The FK is `on delete set null` — existing tickets survive, so
          // mirror that locally instead of refetching.
          setTodos((prev) =>
            prev.map((t) => (t.recurrence_id === id ? { ...t, recurrence_id: null } : t))
          )
        }
      />
    </div>
  );
}

// ---------- manage repeats ----------

function ManageRepeatsDialog({
  open,
  isInbox,
  spaceId,
  onClose,
  onDeleted,
}: {
  open: boolean;
  /** True when viewing the Inbox (space_id IS NULL). */
  isInbox: boolean;
  /** Effective space id for the current page (null = Inbox). */
  spaceId: string | null;
  onClose: () => void;
  onDeleted: (recurrenceId: string) => void;
}) {
  const { user } = useAuth();
  const [recurrences, setRecurrences] = useState<TodoRecurrence[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const rows = await listTodoRecurrences(supabase, user.id);
        // Scope to this space just like the ticket list — Inbox shows the
        // space-less recurrences, a real space shows only its own.
        const scoped = rows.filter((r) =>
          isInbox ? (r.space_id ?? null) === null : r.space_id === spaceId
        );
        if (!cancelled) setRecurrences(scoped);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user, isInbox, spaceId]);

  async function handleDelete(rec: TodoRecurrence) {
    const title = rec.template_json.title;
    if (deletingId) return;
    if (!confirm(`Stop repeating "${title}"? Existing tickets are kept.`)) return;
    setDeletingId(rec.id);
    setErr(null);
    try {
      await deleteTodoRecurrence(supabase, rec.id);
      setRecurrences((prev) => prev.filter((r) => r.id !== rec.id));
      onDeleted(rec.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Repeating tickets"
      description="Deleting a repeat stops future tickets — already-created ones are kept."
    >
      <div className="space-y-3">
        {err && (
          <p role="alert" className="text-sm text-destructive">
            {err}
          </p>
        )}
        {loading ? (
          <SkeletonList rows={2} />
        ) : recurrences.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No repeating tickets yet. Turn on "Repeat" when creating a ticket.
          </p>
        ) : (
          <ul className="space-y-2">
            {recurrences.map((rec) => (
              <li
                key={rec.id}
                className="flex items-start gap-3 rounded-lg border border-border/60 bg-card p-3"
              >
                <Repeat className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{rec.template_json.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {recurrenceLabel(rec)} · from {rec.start_on}
                    {rec.end_on && <> · until {rec.end_on}</>}
                    {" · "}
                    {rec.template_json.priority} priority
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 hover:text-destructive"
                  aria-label={`Stop repeating ${rec.template_json.title}`}
                  disabled={deletingId !== null}
                  onClick={() => handleDelete(rec)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------- multi-select filter ----------

/** Checkbox-dropdown filter. Empty `selected` = no filter (show all). */
function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Array<{ key: string; label: string; color?: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary =
    selected.length === 0
      ? `All ${label}`
      : `${selected.length} ${label.replace(/s$/, "")}${selected.length === 1 ? "" : "s"}`;

  function toggle(key: string) {
    onChange(
      selected.includes(key)
        ? selected.filter((k) => k !== key)
        : [...selected, key]
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs transition-colors",
          selected.length > 0
            ? "border-primary/50 bg-primary/10 text-foreground"
            : "border-input bg-background text-muted-foreground hover:text-foreground"
        )}
      >
        {summary}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="listbox"
            className="absolute right-0 z-50 mt-1 max-h-64 w-52 overflow-auto rounded-md border border-border bg-card py-1 text-xs shadow-md"
          >
            {options.length === 0 ? (
              <div className="px-3 py-1.5 text-muted-foreground">None</div>
            ) : (
              options.map((o) => (
                <label
                  key={o.key}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(o.key)}
                    onChange={() => toggle(o.key)}
                  />
                  {o.color && (
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: o.color }}
                    />
                  )}
                  <span className="truncate">{o.label}</span>
                </label>
              ))
            )}
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="mt-1 w-full border-t border-border px-3 py-1.5 text-left text-primary hover:bg-accent"
              >
                Clear
              </button>
            )}
          </div>
        </>
      )}
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
  // "Tomorrow" means the next calendar day, not "within 48 hours" — a
  // duration check mislabels e.g. Wednesday 5 AM as Tomorrow on Monday night.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (
    diffMs > 0 &&
    due.getFullYear() === tomorrow.getFullYear() &&
    due.getMonth() === tomorrow.getMonth() &&
    due.getDate() === tomorrow.getDate()
  ) {
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
  config: SpaceConfig;
  onToggle: (t: Todo) => void;
  onEdit: (t: Todo) => void;
  onDelete: (t: Todo) => void;
}

function TicketCard({ todo, config, onToggle, onEdit, onDelete }: TicketCardProps) {
  const category = findCategory(todo.category, config.categories);
  const status = findStatus(todo.status, config.statuses);
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
                {status && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight whitespace-nowrap ring-1 ring-inset"
                    style={{
                      color: status.color,
                      backgroundColor: `${status.color}1a`,
                      // 1a ≈ 10% alpha; ring uses the same colour at ~30%.
                      boxShadow: `inset 0 0 0 1px ${status.color}4d`,
                    }}
                  >
                    {status.icon && <span aria-hidden>{status.icon}</span>}
                    {status.label}
                  </span>
                )}
                {category && (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight whitespace-nowrap ring-1 ring-inset ring-border">
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: category.color }}
                    />
                    {category.label}
                  </span>
                )}
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
                {todo.task_date && todo.task_date !== ymd() && (
                  <Badge variant="outline" title="Task date">
                    <CalendarClock className="h-3 w-3" />
                    for{" "}
                    {new Date(`${todo.task_date}T00:00:00`).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}
                  </Badge>
                )}
                {todo.estimated_min != null && (
                  <Badge variant="outline">
                    <Clock className="h-3 w-3" />
                    {formatEstimate(todo.estimated_min)}
                  </Badge>
                )}
                {todo.recurrence_id && (
                  <Badge variant="outline" title="Created by a repeating schedule">
                    <Repeat className="h-3 w-3" />
                    Repeats
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
  /** The date the ticket is for (YYYY-MM-DD); separate from the due deadline. */
  task_date: string | null;
  /** Category key into the space config, or null for none. */
  category: string | null;
  /** Status key into the space config. */
  status: string;
  tags: string[];
  custom: Record<string, unknown>;
  /** Only settable when creating (like finance's TransactionDialog). */
  recurrence: null | {
    frequency: Frequency;
    interval_n: number;
    end_on: string | null;
  };
};

const FREQUENCIES: Frequency[] = ["daily", "weekly", "monthly", "yearly"];

interface TicketDialogProps {
  open: boolean;
  editing: Todo | null;
  config: SpaceConfig;
  onClose: () => void;
  onSave: (draft: TicketDraft) => Promise<void> | void;
}

function TicketDialog({ open, editing, config, onClose, onSave }: TicketDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TodoPriority>("medium");
  const [dueLocal, setDueLocal] = useState(""); // datetime-local string
  const [estimate, setEstimate] = useState("");
  const [taskDate, setTaskDate] = useState(""); // YYYY-MM-DD, the date the ticket is for
  const [category, setCategory] = useState<string>("");
  const [status, setStatus] = useState<string>(DEFAULT_STATUS_KEY);
  const [tagsInput, setTagsInput] = useState("");
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [showRecurrence, setShowRecurrence] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [intervalN, setIntervalN] = useState("1");
  const [endOn, setEndOn] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Default status = first status flagged done:false, else the first one, else
  // the canonical 'todo' key. Keeps a brand-new ticket "open".
  const defaultStatusKey =
    config.statuses.find((s) => !statusIsDone(s.key, config.statuses))?.key ??
    config.statuses[0]?.key ??
    DEFAULT_STATUS_KEY;

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setTitle(editing.title);
      setDescription(editing.description ?? "");
      setPriority(editing.priority);
      setDueLocal(isoToLocalInput(editing.due_at));
      setEstimate(editing.estimated_min == null ? "" : String(editing.estimated_min));
      setTaskDate(editing.task_date ?? "");
      // Only keep the category if it still exists in the space config.
      setCategory(
        editing.category && config.categories.some((c) => c.key === editing.category)
          ? editing.category
          : ""
      );
      setStatus(
        editing.status && config.statuses.some((s) => s.key === editing.status)
          ? editing.status
          : defaultStatusKey
      );
      setTagsInput((editing.tags ?? []).join(", "));
      const seededCustom: Record<string, string> = {};
      for (const f of config.customFields) {
        const v = editing.custom?.[f.key];
        seededCustom[f.key] = v == null ? "" : String(v);
      }
      setCustom(seededCustom);
    } else {
      setTitle("");
      setDescription("");
      setPriority("medium");
      setDueLocal("");
      setEstimate("");
      setTaskDate(ymd()); // default new tickets to today
      setCategory("");
      setStatus(defaultStatusKey);
      setTagsInput("");
      const emptyCustom: Record<string, string> = {};
      for (const f of config.customFields) emptyCustom[f.key] = "";
      setCustom(emptyCustom);
    }
    setShowRecurrence(false);
    setFrequency("daily");
    setIntervalN("1");
    setEndOn("");
    setErr(null);
    // config is intentionally excluded — reseeding on config identity changes
    // would clobber in-progress edits; open/editing drive the reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Build the custom-field payload, validating required + numeric fields.
    const customPayload: Record<string, unknown> = {};
    for (const f of config.customFields) {
      const raw = (custom[f.key] ?? "").trim();
      if (!raw) {
        if (f.required) {
          setErr(`"${f.label}" is required.`);
          return;
        }
        continue;
      }
      if (f.type === "number") {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          setErr(`"${f.label}" must be a number.`);
          return;
        }
        customPayload[f.key] = n;
      } else {
        customPayload[f.key] = raw;
      }
    }
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    setSaving(true);
    setErr(null);
    try {
      await onSave({
        title: trimmedTitle,
        description: description.trim() ? description.trim() : null,
        priority,
        due_at: localInputToIso(dueLocal),
        estimated_min: estMin,
        task_date: taskDate || null,
        category: category || null,
        status,
        tags,
        custom: customPayload,
        recurrence:
          !editing && showRecurrence
            ? {
                frequency,
                interval_n: Math.max(1, Number(intervalN) || 1),
                end_on: endOn || null,
              }
            : null,
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
              inputMode="numeric"
              value={estimate}
              onChange={(e) => setEstimate(e.target.value)}
              placeholder="e.g. 30"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ticket-category">Category</Label>
            <Select
              id="ticket-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={config.categories.length === 0}
            >
              <option value="">
                {config.categories.length === 0 ? "No categories configured" : "None"}
              </option>
              {config.categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ticket-status">Status</Label>
            <Select
              id="ticket-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {config.statuses.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ticket-tags">Tags (comma-separated, optional)</Label>
          <Input
            id="ticket-tags"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="e.g. frontend, urgent"
          />
        </div>

        {config.customFields.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {config.customFields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`ticket-custom-${f.key}`}>
                  {f.label}
                  {f.required && <span className="text-destructive"> *</span>}
                </Label>
                <Input
                  id={`ticket-custom-${f.key}`}
                  type={f.type === "number" ? "number" : "text"}
                  inputMode={f.type === "number" ? "decimal" : undefined}
                  value={custom[f.key] ?? ""}
                  onChange={(e) =>
                    setCustom((c) => ({ ...c, [f.key]: e.target.value }))
                  }
                  required={f.required}
                />
              </div>
            ))}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="ticket-taskdate">Task date</Label>
          <DateField
            id="ticket-taskdate"
            value={taskDate}
            onChange={setTaskDate}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ticket-due">Due (optional)</Label>
          <Input
            id="ticket-due"
            type="datetime-local"
            value={dueLocal}
            onChange={(e) => setDueLocal(e.target.value)}
            // Force-open the native picker on click. By default Chromium
            // only opens the popup when the user clicks the tiny calendar
            // indicator at the right edge; clicking the rest of the field
            // just focuses it for typing. `showPicker()` lets a click
            // anywhere in the field open the picker — supported in Chrome
            // 99+, Edge 99+, Firefox 101+, Safari 16+. Guarded with a
            // typeof check so older browsers still focus + type as before.
            onClick={(e) => {
              const el = e.currentTarget as HTMLInputElement & {
                showPicker?: () => void;
              };
              if (typeof el.showPicker === "function") {
                try {
                  el.showPicker();
                } catch {
                  // showPicker throws outside a user gesture or when the
                  // input is disabled/readonly — safe to ignore.
                }
              }
            }}
            // `color-scheme: dark` makes the native datetime-local calendar
            // icon and popup picker render with dark styling. Without it the
            // icon is dark-on-dark (invisible) on our dark theme.
            className="[color-scheme:dark] cursor-pointer [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-80 hover:[&::-webkit-calendar-picker-indicator]:opacity-100"
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

        {/* Recurrence toggle — creation only, same UX as finance's
            TransactionDialog. Editing a materialised occurrence edits just
            that ticket; the schedule lives under "Repeats". */}
        {!editing && (
          <div className="rounded-md border p-3 space-y-3">
            <button
              type="button"
              onClick={() => setShowRecurrence((s) => !s)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <Repeat className="h-4 w-4" />
              {showRecurrence ? "Remove repeat" : "Repeat"}
            </button>
            {showRecurrence && (
              <>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="space-y-1">
                    <Label htmlFor="ticket-freq">Frequency</Label>
                    <Select
                      id="ticket-freq"
                      value={frequency}
                      onChange={(e) => setFrequency(e.target.value as Frequency)}
                    >
                      {FREQUENCIES.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ticket-interval">Every</Label>
                    <Input
                      id="ticket-interval"
                      type="number"
                      min={1}
                      max={365}
                      value={intervalN}
                      onChange={(e) => setIntervalN(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ticket-end">End on</Label>
                    <Input
                      id="ticket-end"
                      type="date"
                      value={endOn}
                      onChange={(e) => setEndOn(e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {dueLocal
                    ? "Repeats from the due date, at the same time of day."
                    : "No due time set — repeats from today, due 9:00 AM."}{" "}
                  Leave "End on" blank to repeat forever.
                </p>
              </>
            )}
          </div>
        )}

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
