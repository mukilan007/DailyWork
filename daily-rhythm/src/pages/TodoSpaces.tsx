import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Inbox,
  ListTodo,
  MoreVertical,
  Pencil,
  Plus,
  Settings,
  Trash2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Dialog } from "@/components/ui/Dialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import type { TodoSpace } from "@/types";
import { cn } from "@/lib/utils";

/** Open (is_done=false) and total counts for a space or the Inbox. */
type Counts = { open: number; total: number };

/** Postgres unique-violation code — surfaced as a friendly duplicate message. */
const UNIQUE_VIOLATION = "23505";

export function TodoSpacesPage() {
  const { user } = useAuth();
  const [spaces, setSpaces] = useState<TodoSpace[]>([]);
  /** Per-space counts keyed by space id, plus the Inbox under the "inbox" key. */
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const [renaming, setRenaming] = useState<TodoSpace | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TodoSpace | null>(null);
  const [busy, setBusy] = useState(false);
  /** Id of the space whose 3-dot menu is open, or null. */
  const [menuFor, setMenuFor] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      // Spaces + a lightweight todo projection (only what counts need) run in
      // parallel — the todo list itself lives on the per-space page.
      const [spacesRes, todosRes] = await Promise.all([
        supabase
          .from("todo_spaces")
          .select("*")
          .order("position", { ascending: true })
          .order("created_at", { ascending: true }),
        supabase.from("todos").select("id, space_id, is_done"),
      ]);
      if (cancelled) return;
      if (spacesRes.error) {
        setError(spacesRes.error.message);
        setLoading(false);
        return;
      }
      if (todosRes.error) {
        setError(todosRes.error.message);
        setLoading(false);
        return;
      }
      setSpaces((spacesRes.data as TodoSpace[]) ?? []);
      setCounts(tallyCounts(todosRes.data ?? []));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const inboxCounts = counts.inbox ?? { open: 0, total: 0 };
  const activeSpaces = spaces.filter((s) => !s.archived_at);
  const archivedSpaces = spaces.filter((s) => s.archived_at);

  async function setArchived(space: TodoSpace, archived: boolean) {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("todo_spaces")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", space.id)
      .select()
      .single();
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (data) {
      setSpaces((prev) => prev.map((s) => (s.id === space.id ? (data as TodoSpace) : s)));
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("todo_spaces")
      .insert({ user_id: user.id, name, position: spaces.length })
      .select()
      .single();
    setCreating(false);
    if (err) {
      setError(
        err.code === UNIQUE_VIOLATION
          ? `A space named "${name}" already exists.`
          : err.message
      );
      return;
    }
    if (data) {
      setSpaces((prev) => [...prev, data as TodoSpace]);
      setNewName("");
    }
  }

  async function handleRename(name: string) {
    if (!renaming || !user) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("todo_spaces")
      .update({ name: trimmed })
      .eq("id", renaming.id)
      .select()
      .single();
    setBusy(false);
    if (err) {
      // Surface duplicates in the dialog by re-throwing a friendly message.
      throw new Error(
        err.code === UNIQUE_VIOLATION
          ? `A space named "${trimmed}" already exists.`
          : err.message
      );
    }
    if (data) {
      setSpaces((prev) => prev.map((s) => (s.id === renaming.id ? (data as TodoSpace) : s)));
      setRenaming(null);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    setError(null);
    // The todos.space_id FK is `on delete set null`, so deleting the space row
    // moves its tickets to the Inbox — nothing is deleted.
    const { error: err } = await supabase
      .from("todo_spaces")
      .delete()
      .eq("id", confirmDelete.id);
    if (err) {
      setBusy(false);
      setError(err.message);
      setConfirmDelete(null);
      return;
    }
    const movedId = confirmDelete.id;
    setSpaces((prev) => prev.filter((s) => s.id !== movedId));
    // Reflect the FK cascade locally: this space's counts roll into the Inbox.
    setCounts((prev) => {
      const spaceCounts = prev[movedId] ?? { open: 0, total: 0 };
      const inbox = prev.inbox ?? { open: 0, total: 0 };
      const next = { ...prev };
      delete next[movedId];
      next.inbox = {
        open: inbox.open + spaceCounts.open,
        total: inbox.total + spaceCounts.total,
      };
      return next;
    });
    setBusy(false);
    setConfirmDelete(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Todos"
        icon={<ListTodo className="h-5 w-5" />}
        description="Each space keeps its own tickets."
      />

      <form onSubmit={handleCreate} className="flex items-center gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New space name"
          maxLength={80}
          className="max-w-xs"
          aria-label="New space name"
        />
        <Button type="submit" disabled={creating || !newName.trim()}>
          <Plus className="h-4 w-4" /> Create space
        </Button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <SkeletonList rows={3} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* Inbox always leads — it's where every space-less ticket lives. */}
            <Link to="/todos/inbox" className="group block">
              <Card className="h-full transition-shadow hover:shadow-sm">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
                    <Inbox className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">Inbox</div>
                    <div className="text-xs text-muted-foreground">
                      {inboxCounts.open} open
                    </div>
                  </div>
                  <CountBadge open={inboxCounts.open} />
                </CardContent>
              </Card>
            </Link>

            {activeSpaces.map((space) => {
              const c = counts[space.id] ?? { open: 0, total: 0 };
              const menuOpen = menuFor === space.id;
              return (
                <div key={space.id} className="group relative">
                  <Link to={`/todos/${space.id}`} className="block">
                    <Card className="h-full transition-shadow hover:shadow-sm">
                      <CardContent className="flex items-center gap-3 p-4">
                        <span
                          aria-hidden
                          className={cn(
                            "h-3 w-3 shrink-0 rounded-full",
                            space.color ? "" : "bg-muted-foreground/40"
                          )}
                          style={space.color ? { backgroundColor: space.color } : undefined}
                        />
                        <div className="min-w-0 flex-1 pr-16">
                          <div className="truncate font-medium">{space.name}</div>
                          <div className="text-xs text-muted-foreground">{c.open} open</div>
                        </div>
                        <CountBadge open={c.open} />
                      </CardContent>
                    </Card>
                  </Link>
                  {/* 3-dot actions menu, floating above the Link. */}
                  <div className="absolute right-2 top-2">
                    <button
                      type="button"
                      data-open={menuOpen}
                      onClick={(e) => {
                        e.preventDefault();
                        setMenuFor(menuOpen ? null : space.id);
                      }}
                      aria-label={`Actions for ${space.name}`}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100 data-[open=true]:opacity-100"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                    {menuOpen && (
                      <>
                        {/* click-away catcher */}
                        <button
                          type="button"
                          aria-hidden
                          tabIndex={-1}
                          className="fixed inset-0 z-40 cursor-default"
                          onClick={(e) => {
                            e.preventDefault();
                            setMenuFor(null);
                          }}
                        />
                        <div
                          role="menu"
                          className="absolute right-0 z-50 mt-1 w-40 overflow-hidden rounded-md border border-border bg-card py-1 text-sm shadow-md"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(e) => {
                              e.preventDefault();
                              setMenuFor(null);
                              setError(null);
                              setRenaming(space);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-accent"
                          >
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </button>
                          <Link
                            to={`/todos/${space.id}/settings`}
                            role="menuitem"
                            onClick={() => setMenuFor(null)}
                            className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent"
                          >
                            <Settings className="h-3.5 w-3.5" /> Settings
                          </Link>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(e) => {
                              e.preventDefault();
                              setMenuFor(null);
                              void setArchived(space, true);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-accent"
                          >
                            <Archive className="h-3.5 w-3.5" /> Archive
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(e) => {
                              e.preventDefault();
                              setMenuFor(null);
                              setConfirmDelete(space);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {spaces.length === 0 && (
            <EmptyState
              icon={<ListTodo className="h-6 w-6" />}
              title="No spaces yet"
              description="Create a space above to group tickets by project. Ungrouped tickets stay in the Inbox."
            />
          )}

          {archivedSpaces.length > 0 && (
            <div className="space-y-2 pt-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Archived
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {archivedSpaces.map((space) => {
                  const c = counts[space.id] ?? { open: 0, total: 0 };
                  return (
                    <Card key={space.id} className="opacity-70">
                      <CardContent className="flex items-center gap-3 p-4">
                        <span aria-hidden className="h-3 w-3 shrink-0 rounded-full bg-muted-foreground/40" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{space.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {c.total} ticket{c.total === 1 ? "" : "s"} · archived
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void setArchived(space, false)}
                          disabled={busy}
                          aria-label={`Unarchive ${space.name}`}
                          title="Unarchive"
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(space)}
                          aria-label={`Delete ${space.name}`}
                          title="Delete"
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <RenameSpaceDialog
        open={!!renaming}
        initial={renaming}
        busy={busy}
        onClose={() => setRenaming(null)}
        onSave={handleRename}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete space?"
        description="Its tickets move to Inbox, none are deleted."
        destructive
        confirmLabel="Delete"
        busy={busy}
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function CountBadge({ open }: { open: number }) {
  return (
    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
      {open}
    </span>
  );
}

/** Tally open/total counts per space id, with space-less todos under "inbox". */
function tallyCounts(
  rows: { space_id: string | null; is_done: boolean }[]
): Record<string, Counts> {
  const acc: Record<string, Counts> = {};
  for (const r of rows) {
    const key = r.space_id ?? "inbox";
    const c = acc[key] ?? { open: 0, total: 0 };
    c.total += 1;
    if (!r.is_done) c.open += 1;
    acc[key] = c;
  }
  return acc;
}

// ---------- rename dialog ----------

interface RenameSpaceDialogProps {
  open: boolean;
  initial: TodoSpace | null;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}

function RenameSpaceDialog({ open, initial, busy, onClose, onSave }: RenameSpaceDialogProps) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setErr(null);
  }, [open, initial]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setErr(null);
    try {
      await onSave(trimmed);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Rename space">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="space-name">Name</Label>
          <Input
            id="space-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Job hunt"
            maxLength={80}
            required
            autoFocus
          />
        </div>
        {err && (
          <p role="alert" className="text-sm text-destructive">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
