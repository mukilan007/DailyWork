import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { supabase } from "@/lib/supabase";
import { formatINR } from "@/lib/finance";
import { suggestCategory } from "@/lib/import-suggest";
import { cn } from "@/lib/utils";
import type { FinanceCategory, FinanceTransaction } from "@/types";

/**
 * Self-contained "uncategorised auto-categoriser" nudge: an amber banner that
 * appears when the given transactions include income/expense rows without a
 * category, plus a review-first bulk categoriser dialog.
 *
 * Nothing is written to the DB until the user hits "Apply N". Only rows without
 * a category are ever touched — existing categories are never overwritten.
 * Renders nothing when there are no uncategorised rows.
 */
export function UncategorisedNudge({
  transactions,
  categories,
  onApplied,
}: {
  transactions: FinanceTransaction[];
  categories: FinanceCategory[];
  onApplied: (updates: { id: string; category_id: string }[]) => void;
}) {
  const [open, setOpen] = useState(false);

  // Income/expense rows with no category assigned yet. The banner and dialog
  // are driven entirely off this list, so once every row is categorised the
  // length drops to 0 and the banner disappears.
  const uncategorised = useMemo(
    () =>
      transactions.filter(
        (t) => (t.kind === "income" || t.kind === "expense") && !t.category_id
      ),
    [transactions]
  );

  if (uncategorised.length === 0) return null;

  return (
    <>
      {/* Gentle nudge: shown only when there are uncategorised income/expense
          rows. Disappears automatically once none remain. */}
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="text-sm">
              <p className="font-medium text-foreground">
                {uncategorised.length} uncategorised transaction
                {uncategorised.length === 1 ? "" : "s"} in this view
              </p>
              <p className="text-xs text-muted-foreground">
                Review suggested categories and apply them in one tap.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => setOpen(true)}
            className="border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
          >
            Review &amp; apply suggestions
          </Button>
        </CardContent>
      </Card>

      <CategoriseDialog
        open={open}
        onClose={() => setOpen(false)}
        uncategorised={uncategorised}
        categories={categories}
        onApplied={onApplied}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Review-first bulk auto-categoriser dialog
// ---------------------------------------------------------------------------

/** Per-row editable state in the categorise dialog. */
interface CatRowState {
  /** Chosen category id, or "" for skip / no suggestion. */
  category_id: string;
  /** Whether the row is included in the bulk apply. */
  checked: boolean;
}

function CategoriseDialog({
  open,
  onClose,
  uncategorised,
  categories,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  uncategorised: FinanceTransaction[];
  categories: FinanceCategory[];
  onApplied: (updates: { id: string; category_id: string }[]) => void;
}) {
  const [rowState, setRowState] = useState<Record<string, CatRowState>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suggest a category per uncategorised transaction, once, reusing the same
  // helper the statement importer uses.
  const suggestions = useMemo(() => {
    const m = new Map<string, ReturnType<typeof suggestCategory>>();
    for (const t of uncategorised) {
      if (t.kind !== "income" && t.kind !== "expense") continue;
      m.set(t.id, suggestCategory(t.note ?? "", categories, t.kind));
    }
    return m;
  }, [uncategorised, categories]);

  // Prefill on open: check rows that have a suggestion, preselect its category.
  useEffect(() => {
    if (!open) return;
    const init: Record<string, CatRowState> = {};
    for (const t of uncategorised) {
      const s = suggestions.get(t.id);
      init[t.id] = { category_id: s?.category_id ?? "", checked: !!s };
    }
    setRowState(init);
    setError(null);
    // Intentionally keyed on `open` only — we snapshot the current
    // suggestions/rows when the dialog opens and don't want later parent
    // re-renders to reset the user's in-progress choices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Grouped category options per kind: parent → its children (archived
  // excluded, kind-scoped), matching the importer's visual pattern.
  const groupsByKind = useMemo(() => {
    const build = (kind: "income" | "expense") => {
      const parents = categories
        .filter((c) => !c.parent_id && !c.archived_at && c.kind === kind)
        .sort((a, b) => a.position - b.position);
      return parents.map((p) => ({
        parent: p,
        children: categories
          .filter(
            (c) => c.parent_id === p.id && !c.archived_at && c.kind === kind
          )
          .sort((a, b) => a.position - b.position),
      }));
    };
    return { income: build("income"), expense: build("expense") };
  }, [categories]);

  const suggestedCount = useMemo(
    () => [...suggestions.values()].filter(Boolean).length,
    [suggestions]
  );

  // Rows that will actually be written: checked AND with a chosen category.
  const applyCount = useMemo(
    () =>
      uncategorised.filter((t) => {
        const s = rowState[t.id];
        return s?.checked && s.category_id;
      }).length,
    [uncategorised, rowState]
  );

  function setRow(id: string, patch: Partial<CatRowState>) {
    setRowState((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));
  }

  async function handleApply() {
    if (busy || applyCount === 0) return;
    const updates = uncategorised
      .filter((t) => {
        const s = rowState[t.id];
        return s?.checked && s.category_id;
      })
      .map((t) => ({ id: t.id, category_id: rowState[t.id].category_id }));
    setBusy(true);
    setError(null);
    try {
      const results = await Promise.all(
        updates.map((u) =>
          supabase
            .from("finance_transactions")
            .update({ category_id: u.category_id })
            .eq("id", u.id)
        )
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) {
        setError(failed.error.message);
        setBusy(false);
        return;
      }
      onApplied(updates);
      setBusy(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Review & apply categories"
      description="Nothing is saved until you apply. Only transactions without a category are touched — existing categories are never changed."
      className="max-w-3xl"
    >
      {error && (
        <p className="mb-3 text-sm text-rose-500" role="alert">
          {error}
        </p>
      )}

      <p className="mb-2 text-xs text-muted-foreground">
        Suggested {suggestedCount} of {uncategorised.length}.
      </p>

      <div className="max-h-[50vh] overflow-y-auto rounded-md border divide-y">
        {uncategorised.map((t) => {
          const kind =
            t.kind === "income" || t.kind === "expense" ? t.kind : "expense";
          const s = rowState[t.id] ?? { category_id: "", checked: false };
          const hadSuggestion = !!suggestions.get(t.id);
          const groups = groupsByKind[kind];
          return (
            <div
              key={t.id}
              className={cn(
                "flex flex-wrap items-center gap-3 p-3 text-sm sm:flex-nowrap",
                !s.checked && "opacity-60"
              )}
            >
              <input
                type="checkbox"
                checked={s.checked}
                onChange={(e) => setRow(t.id, { checked: e.target.checked })}
                aria-label={`Include ${t.note || "transaction"} on ${t.occurred_on}`}
                className="h-4 w-4 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-foreground">
                    {t.note?.trim() || (
                      <span className="italic text-muted-foreground">
                        (no note)
                      </span>
                    )}
                  </span>
                  {hadSuggestion && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      <Sparkles className="h-2.5 w-2.5" /> suggested
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono">{t.occurred_on}</span>
                  <span className="mx-1.5">·</span>
                  <span
                    className={cn(
                      kind === "income" ? "text-sky-500" : "text-rose-500"
                    )}
                  >
                    {formatINR(t.amount_paise)}
                  </span>
                </div>
              </div>
              <div className="w-full sm:w-56">
                <label className="sr-only" htmlFor={`cat-${t.id}`}>
                  Category for transaction on {t.occurred_on}
                </label>
                <Select
                  id={`cat-${t.id}`}
                  value={s.category_id}
                  onChange={(e) => setRow(t.id, { category_id: e.target.value })}
                  className="h-8 text-xs"
                >
                  <option value="">— skip —</option>
                  {groups.map((g) => (
                    <optgroup key={g.parent.id} label={g.parent.name}>
                      <option value={g.parent.id}>{g.parent.name}</option>
                      {g.children.map((k) => (
                        <option key={k.id} value={k.id}>
                          {"  ↳ "}
                          {k.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
                {groups.length === 0 && (
                  <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
                    No {kind} categories yet — create one on the Categories page.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2 pt-4">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleApply}
          disabled={busy || applyCount === 0}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Applying…
            </>
          ) : (
            <>Apply {applyCount}</>
          )}
        </Button>
      </div>
    </Dialog>
  );
}
