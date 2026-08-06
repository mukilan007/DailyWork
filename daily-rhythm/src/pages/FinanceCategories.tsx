import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Pencil,
  Plus,
  Tag,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import type { CategoryKind, FinanceCategory } from "@/types";
import { cn } from "@/lib/utils";

export function FinanceCategoriesPage() {
  const { user } = useAuth();
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Active tab — categories are separated by kind. */
  const [kindFilter, setKindFilter] = useState<CategoryKind>("expense");
  /** When set, we're drilled into a parent and showing its children. */
  const [drillParent, setDrillParent] = useState<FinanceCategory | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FinanceCategory | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<FinanceCategory | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  /** Index of the row currently being dragged (within `showing`). */
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error: err } = await supabase
        .from("finance_categories")
        .select("*")
        .is("archived_at", null)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (err) setError(err.message);
      else setCategories((data as FinanceCategory[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  /** Stable sibling ordering: by `position`, then creation time as tie-break
   *  (positions can start out all-zero for pre-existing rows). */
  const byOrder = (a: FinanceCategory, b: FinanceCategory) =>
    a.position - b.position || a.created_at.localeCompare(b.created_at);

  const parents = useMemo(
    () =>
      categories
        .filter((c) => !c.parent_id && c.kind === kindFilter)
        .sort(byOrder),
    [categories, kindFilter]
  );
  const childCount = useMemo(() => {
    const m = new Map<string, FinanceCategory[]>();
    for (const c of categories) {
      if (c.parent_id) {
        const arr = m.get(c.parent_id) ?? [];
        arr.push(c);
        m.set(c.parent_id, arr);
      }
    }
    return m;
  }, [categories]);

  function openAdd() {
    setEditing(null);
    setDialogError(null);
    setDialogOpen(true);
  }
  function openEdit(c: FinanceCategory) {
    setEditing(c);
    setDialogError(null);
    setDialogOpen(true);
  }
  function closeDialog() {
    setDialogOpen(false);
    setDialogError(null);
  }

  async function handleSave(name: string) {
    if (!user) return;
    setBusy(true);
    setDialogError(null);
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    // Dup-check scope: same kind, same parent (so "Food" can exist under
    // both Income and Expense, and under each top-level parent).
    const scopeParentId = editing
      ? editing.parent_id
      : drillParent?.id ?? null;
    const scopeKind: CategoryKind = editing
      ? editing.kind
      : drillParent?.kind ?? kindFilter;
    const dup = categories.find(
      (c) =>
        c.id !== editing?.id &&
        (c.parent_id ?? null) === scopeParentId &&
        c.kind === scopeKind &&
        c.name.trim().toLowerCase() === key
    );
    if (dup) {
      const prefix = scopeParentId ? "A subcategory" : "A category";
      setDialogError(`${prefix} named "${dup.name}" already exists.`);
      setBusy(false);
      return;
    }
    if (editing) {
      const { data, error: err } = await supabase
        .from("finance_categories")
        .update({ name: trimmed })
        .eq("id", editing.id)
        .select()
        .single();
      if (err) {
        setDialogError(err.message);
        setBusy(false);
        return;
      }
      if (data)
        setCategories((cur) =>
          cur.map((c) => (c.id === editing.id ? (data as FinanceCategory) : c))
        );
    } else {
      const parent_id = drillParent?.id ?? null;
      // Subcategories inherit their parent's kind; new top-level categories
      // pick up the active tab.
      const newKind: CategoryKind = drillParent?.kind ?? kindFilter;
      const sibs = categories.filter(
        (c) => c.parent_id === parent_id && c.kind === newKind
      );
      const { data, error: err } = await supabase
        .from("finance_categories")
        .insert({
          user_id: user.id,
          name: trimmed,
          kind: newKind,
          parent_id,
          position: sibs.length,
        })
        .select()
        .single();
      if (err) {
        setDialogError(err.message);
        setBusy(false);
        return;
      }
      if (data) setCategories((cur) => [...cur, data as FinanceCategory]);
    }
    setBusy(false);
    closeDialog();
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    // Soft-delete: archive the category (and its descendants) rather than
    // physically removing the row. The row stays in the DB so any transaction
    // already pointing at it can still resolve its name for display, while
    // pickers (which filter by `archived_at is null`) treat it as gone.
    const subtreeIds = [
      confirmDelete.id,
      ...categories
        .filter((c) => c.parent_id === confirmDelete.id)
        .map((c) => c.id),
    ];
    const { error: err } = await supabase
      .from("finance_categories")
      .update({ archived_at: new Date().toISOString() })
      .in("id", subtreeIds);
    setBusy(false);
    if (err) {
      setError(err.message);
      setConfirmDelete(null);
      return;
    }
    setCategories((cur) => cur.filter((c) => !subtreeIds.includes(c.id)));
    setConfirmDelete(null);
  }

  const showing = useMemo(
    () =>
      drillParent
        ? categories.filter((c) => c.parent_id === drillParent.id).sort(byOrder)
        : parents,
    [drillParent, categories, parents]
  );

  /** Persist a new sibling order: assign sequential positions and update only
   *  the rows that actually moved. Optimistic, rolls back on any failure. */
  async function persistOrder(reordered: FinanceCategory[]) {
    const updates: Array<{ id: string; position: number }> = [];
    reordered.forEach((c, i) => {
      if (c.position !== i) updates.push({ id: c.id, position: i });
    });
    if (updates.length === 0) return;

    const prev = categories;
    const newPos = new Map(updates.map((u) => [u.id, u.position]));
    setCategories((cur) =>
      cur.map((c) => (newPos.has(c.id) ? { ...c, position: newPos.get(c.id)! } : c))
    );

    const results = await Promise.all(
      updates.map((u) =>
        supabase
          .from("finance_categories")
          .update({ position: u.position })
          .eq("id", u.id)
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      setCategories(prev); // roll back the whole group
      setError(failed.error.message);
    }
  }

  /** Move a row up (-1) or down (+1) within its sibling group. */
  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= showing.length) return;
    const reordered = [...showing];
    const [item] = reordered.splice(index, 1);
    reordered.splice(target, 0, item);
    void persistOrder(reordered);
  }

  function handleDrop(dropIndex: number) {
    const from = dragIndex;
    setDragIndex(null);
    if (from === null || from === dropIndex) return;
    const reordered = [...showing];
    const [item] = reordered.splice(from, 1);
    reordered.splice(dropIndex, 0, item);
    void persistOrder(reordered);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories"
        description={
          drillParent
            ? `Subcategories of ${drillParent.name}`
            : `${kindFilter === "income" ? "Income" : "Expense"} categories. Tap a category to manage its subcategories.`
        }
        icon={<Tag className="h-5 w-5" />}
        actions={
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" />
            {drillParent ? "Add subcategory" : "Add category"}
          </Button>
        }
      />

      {!drillParent && (
        <div className="grid grid-cols-2 gap-2 max-w-xs">
          {(["expense", "income"] as CategoryKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKindFilter(k)}
              className={cn(
                "rounded-md border px-3 py-2 text-sm font-medium capitalize transition-colors",
                kindFilter === k
                  ? k === "income"
                    ? "border-sky-500 text-sky-500"
                    : "border-rose-500 text-rose-500"
                  : "border-input text-muted-foreground hover:text-foreground"
              )}
            >
              {k}
            </button>
          ))}
        </div>
      )}

      {drillParent && (
        <button
          type="button"
          onClick={() => setDrillParent(null)}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to all categories
        </button>
      )}

      {error && (
        <p className="text-sm text-rose-500" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <SkeletonList rows={4} />
      ) : showing.length === 0 ? (
        <EmptyState
          icon={<Tag className="h-6 w-6" />}
          title={drillParent ? "No subcategories yet" : "No categories yet"}
          description={
            drillParent
              ? `Add subcategories under ${drillParent.name} to break down spending.`
              : `Add your first category to get started.`
          }
          action={
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4" />
              {drillParent ? "Add subcategory" : "Add category"}
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {showing.map((c, i) => {
                const children = childCount.get(c.id) ?? [];
                return (
                  <li
                    key={c.id}
                    onDragOver={(e) => {
                      if (dragIndex !== null) e.preventDefault();
                    }}
                    onDrop={() => handleDrop(i)}
                    className={cn(
                      "flex items-center justify-between gap-2 px-3 sm:px-5 py-3 text-sm",
                      dragIndex === i && "opacity-50",
                      dragIndex !== null && dragIndex !== i && "hover:bg-accent/40"
                    )}
                  >
                    {/* Drag handle — starts the drag; drop anywhere on a row. */}
                    <span
                      draggable
                      onDragStart={() => setDragIndex(i)}
                      onDragEnd={() => setDragIndex(null)}
                      aria-label={`Drag to reorder ${c.name}`}
                      title="Drag to reorder"
                      className="shrink-0 cursor-grab active:cursor-grabbing rounded-md p-1 text-muted-foreground/60 hover:text-foreground"
                    >
                      <GripVertical className="h-4 w-4" />
                    </span>
                    <button
                      type="button"
                      disabled={!!drillParent}
                      onClick={() => !drillParent && setDrillParent(c)}
                      className={cn(
                        "flex-1 min-w-0 text-left",
                        !drillParent && children.length > 0 && "cursor-pointer"
                      )}
                    >
                      <div className="font-medium flex items-center gap-2">
                        <span className="truncate">{c.name}</span>
                        {!drillParent && children.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            ({children.length})
                          </span>
                        )}
                      </div>
                      {!drillParent && children.length > 0 && (
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {children.map((s) => s.name).join(", ")}
                        </div>
                      )}
                    </button>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {/* Up / down — keyboard- and touch-friendly reordering. */}
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        aria-label={`Move ${c.name} up`}
                        className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={i === showing.length - 1}
                        aria-label={`Move ${c.name} down`}
                        className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(c)}
                        aria-label={`Edit ${c.name}`}
                        className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(c)}
                        aria-label={`Delete ${c.name}`}
                        className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      {!drillParent && (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <CategoryDialog
        open={dialogOpen}
        onClose={closeDialog}
        initial={editing}
        label={drillParent ? "subcategory" : "category"}
        onSave={handleSave}
        busy={busy}
        error={dialogError}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete category?"
        description={
          confirmDelete
            ? `"${confirmDelete.name}"${
                childCount.get(confirmDelete.id)?.length
                  ? ` and its ${childCount.get(confirmDelete.id)?.length} subcategor${
                      childCount.get(confirmDelete.id)!.length === 1 ? "y" : "ies"
                    }`
                  : ""
              } will be removed from pickers. Existing transactions keep their category label for reference.`
            : ""
        }
        destructive
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(null)}
        busy={busy}
      />
    </div>
  );
}

interface CategoryDialogProps {
  open: boolean;
  onClose: () => void;
  initial: FinanceCategory | null;
  label: string;
  onSave: (name: string) => void | Promise<void>;
  busy: boolean;
  error: string | null;
}

function CategoryDialog({
  open,
  onClose,
  initial,
  label,
  onSave,
  busy,
  error,
}: CategoryDialogProps) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
  }, [open, initial]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    void onSave(trimmed);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${initial ? "Edit" : "Add"} ${label}`}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cat-name">Name</Label>
          <Input
            id="cat-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Night food"
            required
            autoFocus
          />
        </div>
        {error && (
          <p className="text-sm text-rose-500" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {initial ? "Save" : "Add"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
