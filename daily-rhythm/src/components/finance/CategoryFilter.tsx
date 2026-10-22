import { useEffect, useMemo } from "react";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import type { CategoryKind, FinanceCategory, FinanceTransaction } from "@/types";

/**
 * Shared Category + Subcategory slicer for the Finance pages.
 *
 * A transaction's `category_id` points at a *leaf*, which may be either a
 * top-level category or one of its subcategories. So "show me Chennai" has to
 * match rows filed directly on Chennai as well as rows filed on any of its
 * children — hence the roll-up in `makeCategoryMatcher`.
 */

/** `"all"` | `"uncategorised"` | a top-level category id. */
export type CategorySelection = string;
/** `"all"` | `"none"` (filed on the parent itself) | a subcategory id. */
export type SubcategorySelection = string;

export interface CategoryFilterValue {
  categoryId: CategorySelection;
  subcategoryId: SubcategorySelection;
}

export const ALL_CATEGORIES: CategoryFilterValue = {
  categoryId: "all",
  subcategoryId: "all",
};

export function isCategoryFilterActive(v: CategoryFilterValue): boolean {
  return v.categoryId !== "all" || v.subcategoryId !== "all";
}

/** Active top-level categories, optionally narrowed to one kind. */
export function topCategoryOptions(
  categories: FinanceCategory[],
  kind?: CategoryKind
): FinanceCategory[] {
  return categories.filter(
    (c) => !c.parent_id && !c.archived_at && (kind ? c.kind === kind : true)
  );
}

/** Active children of `parentId` (empty when no real category is selected). */
export function subcategoryOptions(
  categories: FinanceCategory[],
  parentId: CategorySelection
): FinanceCategory[] {
  if (parentId === "all" || parentId === "uncategorised") return [];
  return categories.filter((c) => c.parent_id === parentId && !c.archived_at);
}

/**
 * Build a predicate for the selection. Transfers carry no category, so they
 * drop out as soon as either filter is narrowed — which is what you want when
 * asking "how much went to Chennai / Travel".
 */
export function makeCategoryMatcher(
  categories: FinanceCategory[],
  value: CategoryFilterValue
): (t: FinanceTransaction) => boolean {
  const { categoryId, subcategoryId } = value;
  if (categoryId === "all" && subcategoryId === "all") return () => true;

  const byId = new Map(categories.map((c) => [c.id, c]));

  return (t: FinanceTransaction) => {
    const cat = t.category_id ? byId.get(t.category_id) : undefined;

    if (categoryId === "uncategorised") return !t.category_id;
    if (categoryId !== "all") {
      if (!cat) return false;
      const topId = cat.parent_id ?? cat.id;
      if (topId !== categoryId) return false;
    }

    if (subcategoryId === "all") return true;
    if (!cat) return false;
    // "none" = filed on the top-level category itself, not on a child.
    if (subcategoryId === "none") return !cat.parent_id;
    return cat.id === subcategoryId;
  };
}

interface CategoryFilterFieldsProps {
  categories: FinanceCategory[];
  value: CategoryFilterValue;
  onChange: (next: CategoryFilterValue) => void;
  /** Narrows the top-level options to one kind (Stats scopes by its side tab). */
  kind?: CategoryKind;
  /** Disambiguates the input ids when two instances share a page. */
  idPrefix?: string;
  className?: string;
}

/** The two <Select>s. Caller owns the state so it can live in a page or a
 *  shared context without this component caring which. */
export function CategoryFilterFields({
  categories,
  value,
  onChange,
  kind,
  idPrefix = "cat",
  className,
}: CategoryFilterFieldsProps) {
  const tops = useMemo(
    () => topCategoryOptions(categories, kind),
    [categories, kind]
  );
  const subs = useMemo(
    () => subcategoryOptions(categories, value.categoryId),
    [categories, value.categoryId]
  );

  // Keep the selection reachable: when `kind` flips or categories reload, a
  // now-missing category (or subcategory) would otherwise leave the filter
  // stuck on rows the user can no longer see or clear from the dropdown.
  useEffect(() => {
    if (
      value.categoryId !== "all" &&
      value.categoryId !== "uncategorised" &&
      !tops.some((c) => c.id === value.categoryId)
    ) {
      onChange(ALL_CATEGORIES);
      return;
    }
    if (
      value.subcategoryId !== "all" &&
      value.subcategoryId !== "none" &&
      !subs.some((c) => c.id === value.subcategoryId)
    ) {
      onChange({ ...value, subcategoryId: "all" });
    }
  }, [tops, subs, value, onChange]);

  const subsDisabled = value.categoryId === "all" || value.categoryId === "uncategorised";

  return (
    <>
      <div className={className}>
        <Label htmlFor={`${idPrefix}-filter`} className="text-xs text-muted-foreground">
          Category
        </Label>
        <Select
          id={`${idPrefix}-filter`}
          value={value.categoryId}
          onChange={(e) =>
            // Changing the parent always resets the child — a subcategory of
            // the previous parent is meaningless under the new one.
            onChange({ categoryId: e.target.value, subcategoryId: "all" })
          }
          className="h-9 text-sm"
        >
          <option value="all">All categories</option>
          {kind ? (
            tops.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))
          ) : (
            // Unscoped (Transactions shows both kinds): group by kind, since
            // the same name can exist as both an expense and an income
            // category and the bare list would be ambiguous.
            <>
              {(["expense", "income"] as const).map((k) => {
                const group = tops.filter((c) => c.kind === k);
                if (group.length === 0) return null;
                return (
                  <optgroup key={k} label={k === "expense" ? "Expense" : "Income"}>
                    {group.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </>
          )}
          <option value="uncategorised">Uncategorised</option>
        </Select>
      </div>

      <div className={className}>
        <Label htmlFor={`${idPrefix}-sub-filter`} className="text-xs text-muted-foreground">
          Subcategory
        </Label>
        <Select
          id={`${idPrefix}-sub-filter`}
          value={value.subcategoryId}
          disabled={subsDisabled}
          onChange={(e) => onChange({ ...value, subcategoryId: e.target.value })}
          className="h-9 text-sm"
          title={subsDisabled ? "Pick a category first" : undefined}
        >
          <option value="all">
            {subsDisabled ? "Pick a category first" : "All subcategories"}
          </option>
          {!subsDisabled && <option value="none">No subcategory</option>}
          {subs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
    </>
  );
}
