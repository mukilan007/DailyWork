import { FormEvent, useEffect, useMemo, useState } from "react";
import { ChevronRight, Pencil, Plus, Tag, Trash2 } from "lucide-react";
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
  const [kind, setKind] = useState<CategoryKind>("expense");
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** When set, we're drilled into a parent and showing its children. */
  const [drillParent, setDrillParent] = useState<FinanceCategory | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FinanceCategory | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<FinanceCategory | null>(null);
  const [busy, setBusy] = useState(false);

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

  const ofKind = useMemo(
    () => categories.filter((c) => c.kind === kind),
    [categories, kind]
  );
  const parents = useMemo(() => ofKind.filter((c) => !c.parent_id), [ofKind]);
  const childCount = useMemo(() => {
    const m = new Map<string, FinanceCategory[]>();
    for (const c of ofKind) {
      if (c.parent_id) {
        const arr = m.get(c.parent_id) ?? [];
        arr.push(c);
        m.set(c.parent_id, arr);
      }
    }
    return m;
  }, [ofKind]);

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(c: FinanceCategory) {
    setEditing(c);
    setDialogOpen(true);
  }

  async function handleSave(name: string) {
    if (!user) return;
    setBusy(true);
    setError(null);
    if (editing) {
      const { data, error: err } = await supabase
        .from("finance_categories")
        .update({ name })
        .eq("id", editing.id)
        .select()
        .single();
      if (err) setError(err.message);
      else if (data)
        setCategories((cur) =>
          cur.map((c) => (c.id === editing.id ? (data as FinanceCategory) : c))
        );
    } else {
      const parent_id = drillParent?.id ?? null;
      const sibs = ofKind.filter((c) => c.parent_id === parent_id);
      const { data, error: err } = await supabase
        .from("finance_categories")
        .insert({
          user_id: user.id,
          name,
          kind,
          parent_id,
          position: sibs.length,
        })
        .select()
        .single();
      if (err) setError(err.message);
      else if (data) setCategories((cur) => [...cur, data as FinanceCategory]);
    }
    setBusy(false);
    setDialogOpen(false);
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    const { error: err } = await supabase
      .from("finance_categories")
      .delete()
      .eq("id", confirmDelete.id);
    setBusy(false);
    if (err) {
      setError(err.message);
      setConfirmDelete(null);
      return;
    }
    // Cascade in DB removes children too — reflect that in state.
    setCategories((cur) =>
      cur.filter((c) => c.id !== confirmDelete.id && c.parent_id !== confirmDelete.id)
    );
    setConfirmDelete(null);
  }

  const showing = drillParent
    ? ofKind.filter((c) => c.parent_id === drillParent.id)
    : parents;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories"
        description={
          drillParent
            ? `Subcategories of ${drillParent.name}`
            : "Group your transactions. Tap a category to manage its subcategories."
        }
        icon={<Tag className="h-5 w-5" />}
        actions={
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" />
            {drillParent ? "Add subcategory" : "Add category"}
          </Button>
        }
      />

      {/* Income / Expense toggle — only at top level */}
      {!drillParent && (
        <div className="inline-flex rounded-md border bg-card p-0.5 text-sm">
          {(["income", "expense"] as CategoryKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "rounded-sm px-4 py-1.5 capitalize transition-colors",
                kind === k
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
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
              : `Add your first ${kind} category to get started.`
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
              {showing.map((c) => {
                const children = childCount.get(c.id) ?? [];
                return (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
                  >
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
                    <div className="flex items-center gap-1 shrink-0">
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
        onClose={() => setDialogOpen(false)}
        initial={editing}
        label={drillParent ? "subcategory" : "category"}
        onSave={handleSave}
        busy={busy}
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
              } will be removed. Transactions stay but lose this category.`
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
}

function CategoryDialog({
  open,
  onClose,
  initial,
  label,
  onSave,
  busy,
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
