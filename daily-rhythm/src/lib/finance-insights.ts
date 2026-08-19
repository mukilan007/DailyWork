// Pure, I/O-free analytics for the Finance Stats page. Everything here is
// derived from already-loaded transactions (a "current" period plus the
// equal-length "previous" period) — no DB access, no schema dependency.

import type { FinanceCategory, FinanceTransaction } from "@/types";
import { formatINR } from "@/lib/finance";

// ----------------------------------------------------------------------------
// Small numeric helpers (exported for testability)
// ----------------------------------------------------------------------------

/** Sum of a list of numbers (0 for empty). */
export function sum(nums: number[]): number {
  let total = 0;
  for (const n of nums) total += n;
  return total;
}

/** Median of a list of numbers (0 for empty). */
export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ----------------------------------------------------------------------------
// Top-category roll-up — identical rule to sliceByTopCategory in finance.ts:
// subcategory rolls up into its parent; missing/none → "uncategorised".
// ----------------------------------------------------------------------------

function topCategoryOf(
  t: FinanceTransaction,
  catMap: Map<string, FinanceCategory>
): { key: string; label: string } {
  const cat = t.category_id ? catMap.get(t.category_id) : undefined;
  const top = cat?.parent_id ? catMap.get(cat.parent_id) ?? cat : cat;
  return {
    key: top?.id ?? "uncategorised",
    label: top?.name ?? "Uncategorised",
  };
}

// ----------------------------------------------------------------------------
// Month-over-month category deltas
// ----------------------------------------------------------------------------

export type CategoryDelta = {
  key: string;
  label: string;
  currentTotal: number;
  prevTotal: number;
  /** Percent change vs previous; null when prevTotal is 0 (brand-new spend). */
  deltaPct: number | null;
};

/**
 * Aggregate `side` transactions by top-level category for both the current and
 * previous period, keyed the SAME way as sliceByTopCategory (top-category id,
 * or "uncategorised"). Every key that appears in either period is present.
 */
export function computeCategoryDeltas(
  current: FinanceTransaction[],
  previous: FinanceTransaction[],
  categories: FinanceCategory[],
  side: "income" | "expense"
): Map<string, CategoryDelta> {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const out = new Map<string, CategoryDelta>();

  const ensure = (key: string, label: string): CategoryDelta => {
    let e = out.get(key);
    if (!e) {
      e = { key, label, currentTotal: 0, prevTotal: 0, deltaPct: null };
      out.set(key, e);
    }
    return e;
  };

  for (const t of current) {
    if (t.kind !== side) continue;
    const { key, label } = topCategoryOf(t, catMap);
    ensure(key, label).currentTotal += t.amount_paise;
  }
  for (const t of previous) {
    if (t.kind !== side) continue;
    const { key, label } = topCategoryOf(t, catMap);
    ensure(key, label).prevTotal += t.amount_paise;
  }

  for (const e of out.values()) {
    e.deltaPct =
      e.prevTotal > 0
        ? ((e.currentTotal - e.prevTotal) / e.prevTotal) * 100
        : null;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Auto-insights
// ----------------------------------------------------------------------------

export type FinanceInsight = {
  id: string;
  text: string;
  tone: "up" | "down" | "neutral" | "alert";
};

export type FinanceInsightInput = {
  current: FinanceTransaction[];
  previous: FinanceTransaction[];
  categories: FinanceCategory[];
  side: "income" | "expense";
  /** Present when the viewed window is a single calendar month. */
  month?: { isCurrent: boolean; daysElapsed: number; daysInMonth: number };
};

/** Render a multiplier like 3, 2.5, 3.4 (nearest tenth, trailing .0 dropped). */
function formatRatio(r: number): string {
  const rounded = Math.round(r * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Up to 5 plain-English findings, in priority order, each emitted only when the
 * data supports it. Returns [] when nothing material stands out.
 */
export function computeFinanceInsights(
  input: FinanceInsightInput
): FinanceInsight[] {
  const { current, previous, categories, side, month } = input;
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const sideNoun = side === "expense" ? "expense" : "income";
  const sidePlural = side === "expense" ? "expenses" : "income";
  const insights: FinanceInsight[] = [];

  const deltas = computeCategoryDeltas(current, previous, categories, side);
  const sideTx = current.filter((t) => t.kind === side);

  // (a) Biggest movers vs previous period — material size + material change.
  const movers = [...deltas.values()]
    .filter(
      (d) =>
        d.deltaPct !== null &&
        Math.max(d.currentTotal, d.prevTotal) >= 50000 &&
        Math.abs(d.deltaPct) >= 20
    )
    .sort(
      (a, b) =>
        Math.abs(b.currentTotal - b.prevTotal) -
        Math.abs(a.currentTotal - a.prevTotal)
    );
  for (const d of movers.slice(0, 2)) {
    const pct = d.deltaPct as number;
    const up = pct > 0;
    insights.push({
      id: `mover-${d.key}`,
      text: `${d.label} is ${up ? "up" : "down"} ${Math.abs(
        Math.round(pct)
      )}% vs last period (${formatINR(d.prevTotal)} → ${formatINR(
        d.currentTotal
      )}).`,
      tone: up ? "up" : "down",
    });
  }

  // (a, cont.) Brand-new category this period (no prior spend, now >= ₹1,000).
  const brandNew = [...deltas.values()]
    .filter(
      (d) =>
        d.prevTotal === 0 &&
        d.currentTotal >= 100000 &&
        d.key !== "uncategorised"
    )
    .sort((a, b) => b.currentTotal - a.currentTotal)[0];
  if (brandNew) {
    insights.push({
      id: `new-${brandNew.key}`,
      text: `New this period: ${brandNew.label} ${formatINR(
        brandNew.currentTotal
      )}.`,
      tone: "neutral",
    });
  }

  // (b) Largest single transaction vs typical for its category.
  if (sideTx.length > 0) {
    const maxTx = sideTx.reduce((m, t) =>
      t.amount_paise > m.amount_paise ? t : m
    );
    const { key, label } = topCategoryOf(maxTx, catMap);
    const catAmounts = sideTx
      .filter((t) => topCategoryOf(t, catMap).key === key)
      .map((t) => t.amount_paise);
    const typical = median(catAmounts);
    if (
      catAmounts.length >= 3 &&
      typical > 0 &&
      maxTx.amount_paise >= 2 * typical
    ) {
      const noteStr = maxTx.note?.trim() || sideNoun;
      insights.push({
        id: `largest-${maxTx.id}`,
        text: `${formatINR(
          maxTx.amount_paise
        )} at ${noteStr} is your largest ${sideNoun} — ${formatRatio(
          maxTx.amount_paise / typical
        )}× your typical ${label} spend.`,
        tone: "alert",
      });
    }
  }

  // (c) Spend pace / projection — only for the in-progress current month.
  if (month?.isCurrent && side === "expense" && month.daysElapsed > 0) {
    const currentExpenseTotal = sum(
      current.filter((t) => t.kind === "expense").map((t) => t.amount_paise)
    );
    if (currentExpenseTotal > 0) {
      const projected =
        (currentExpenseTotal / month.daysElapsed) * month.daysInMonth;
      const prevExpenseTotal = sum(
        previous.filter((t) => t.kind === "expense").map((t) => t.amount_paise)
      );
      const exceeds = prevExpenseTotal > 0 && projected > prevExpenseTotal;
      insights.push({
        id: "pace",
        text: `You've spent ${formatINR(currentExpenseTotal)} in the first ${
          month.daysElapsed
        } day${
          month.daysElapsed === 1 ? "" : "s"
        } — on pace for ${formatINR(Math.round(projected))} this month.`,
        tone: exceeds ? "alert" : "neutral",
      });
    }
  }

  // (d) Net / savings — needs both income and expense in the current period.
  const incomeTotal = sum(
    current.filter((t) => t.kind === "income").map((t) => t.amount_paise)
  );
  const expenseTotal = sum(
    current.filter((t) => t.kind === "expense").map((t) => t.amount_paise)
  );
  if (incomeTotal > 0 && expenseTotal > 0) {
    if (incomeTotal > expenseTotal) {
      const saved = incomeTotal - expenseTotal;
      const pct = Math.round((saved / incomeTotal) * 100);
      insights.push({
        id: "savings",
        text: `You saved ${formatINR(
          saved
        )} this period (${pct}% of income).`,
        tone: "down",
      });
    } else {
      insights.push({
        id: "overspend",
        text: `Spending exceeded income by ${formatINR(
          expenseTotal - incomeTotal
        )} this period.`,
        tone: "alert",
      });
    }
  }

  // (e) Top category concentration — dominant share of the side total.
  const sideTotal = sum(sideTx.map((t) => t.amount_paise));
  if (sideTotal > 0) {
    const largest = [...deltas.values()].reduce(
      (m, d) => (d.currentTotal > m.currentTotal ? d : m),
      { key: "", label: "", currentTotal: 0, prevTotal: 0, deltaPct: null } as CategoryDelta
    );
    const share = (largest.currentTotal / sideTotal) * 100;
    if (largest.currentTotal > 0 && share >= 35) {
      insights.push({
        id: `share-${largest.key}`,
        text: `${largest.label} is ${Math.round(
          share
        )}% of your ${sidePlural} this period.`,
        tone: "neutral",
      });
    }
  }

  return insights.slice(0, 5);
}
