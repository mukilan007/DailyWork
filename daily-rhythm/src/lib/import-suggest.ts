// Suggest a category for a parsed transaction and detect duplicates against
// rows already in the database.

import type { FinanceCategory, FinanceTransaction } from "@/types";
import type { ParsedRow } from "@/lib/pdf-statement";

/** Built-in merchant → category-name keyword map. The values are matched
 *  case-insensitively against the user's existing category / parent names. */
const KEYWORD_HINTS: Array<{ patterns: string[]; categories: string[] }> = [
  { patterns: ["swiggy", "zomato", "dominos", "kfc", "mcdonald", "food", "restaurant", "cafe"], categories: ["food", "restaurant", "dining"] },
  { patterns: ["uber", "ola", "rapido", "metro", "irctc", "bus", "petrol", "fuel", "diesel"], categories: ["travel", "transport", "commute", "fuel"] },
  { patterns: ["amazon", "flipkart", "myntra", "ajio", "meesho"], categories: ["shopping", "online"] },
  { patterns: ["netflix", "spotify", "prime", "hotstar", "youtube"], categories: ["entertainment", "subscription"] },
  { patterns: ["electricity", "bescom", "tneb", "msedcl", "gas", "water", "wifi", "broadband", "airtel", "jio", "vodafone", "vi "], categories: ["utilities", "bills"] },
  { patterns: ["rent"], categories: ["rent", "housing"] },
  { patterns: ["salary", "payroll"], categories: ["salary", "income"] },
  { patterns: ["interest credit", "int.coll", "interest pd"], categories: ["interest", "income"] },
  { patterns: ["pharmacy", "apollo", "medplus", "hospital", "clinic"], categories: ["health", "medical"] },
  { patterns: ["atm", "cash wdl", "cash withdrawal"], categories: ["cash", "atm"] },
];

export interface CategorySuggestion {
  category_id: string;
  parent_id: string | null;
}

/**
 * Try to find a category that matches the parsed description.
 * Matching order:
 *  1. Direct substring match on existing category names. If we find a *child*
 *     match we also return its `parent_id` so the UI can show the full path.
 *  2. Hard-coded keyword hints → look for any category whose name overlaps.
 *
 * Categories are no longer scoped by income/expense kind, so the `kind`
 * parameter is accepted for backward compatibility but not used here.
 */
export function suggestCategory(
  description: string,
  categories: FinanceCategory[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _kind: "income" | "expense"
): CategorySuggestion | null {
  const desc = description.toLowerCase();
  const active = categories.filter((c) => !c.archived_at);

  // Children win over parents — they're more specific.
  const children = active.filter((c) => c.parent_id);
  const parents = active.filter((c) => !c.parent_id);

  for (const c of children) {
    if (c.name && desc.includes(c.name.toLowerCase())) {
      return { category_id: c.id, parent_id: c.parent_id ?? null };
    }
  }
  for (const c of parents) {
    if (c.name && desc.includes(c.name.toLowerCase())) {
      return { category_id: c.id, parent_id: null };
    }
  }

  for (const hint of KEYWORD_HINTS) {
    if (!hint.patterns.some((p) => desc.includes(p))) continue;
    for (const c of children) {
      const name = (c.name ?? "").toLowerCase();
      if (hint.categories.some((cat) => name.includes(cat))) {
        return { category_id: c.id, parent_id: c.parent_id ?? null };
      }
    }
    for (const c of parents) {
      const name = (c.name ?? "").toLowerCase();
      if (hint.categories.some((cat) => name.includes(cat))) {
        return { category_id: c.id, parent_id: null };
      }
    }
  }

  return null;
}

/**
 * Return the set of indices in `parsed` that already exist in `existing`
 * (same account, same date, same kind, same amount). Used to pre-deselect
 * obviously duplicate rows in the review UI.
 */
export function findDuplicates(
  parsed: ParsedRow[],
  existing: FinanceTransaction[],
  accountId: string
): Set<number> {
  // Index existing rows for the chosen account by (date|kind|amount).
  const seen = new Set<string>();
  for (const t of existing) {
    if (t.account_id !== accountId) continue;
    if (t.kind === "transfer") continue;
    seen.add(`${t.occurred_on}|${t.kind}|${t.amount_paise}`);
  }
  const dups = new Set<number>();
  parsed.forEach((p, i) => {
    if (seen.has(`${p.occurred_on}|${p.kind}|${p.amount_paise}`)) dups.add(i);
  });
  return dups;
}
