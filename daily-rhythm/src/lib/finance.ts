// Pure helpers for the Finance / Expense Tracker module.
// All currency values are integers (paise = ₹ * 100) to avoid float bugs.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AccountType,
  FinanceAccount,
  FinanceCategory,
  FinanceRecurrence,
  FinanceTransaction,
  Frequency,
  RecurrenceTemplate,
  TxKind,
} from "@/types";
import { ymd } from "@/lib/dates";

// ----------------------------------------------------------------------------
// Money formatting
// ----------------------------------------------------------------------------

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/** Parse a user-typed rupees string ("1,234.50", "1234", ".5") to paise. */
export function rupeesToPaise(input: string): number | null {
  const cleaned = input.replace(/[,\s₹]/g, "").trim();
  if (!cleaned) return null;
  if (!/^\d*(\.\d{0,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const INR_FMT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

/** Format paise as "₹1,234.50". Returns "—" for null/undefined. */
export function formatINR(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "—";
  return INR_FMT.format(paise / 100);
}

/** Compact "1,234" with no symbol or decimals, used in the calendar grid. */
export function formatRupeesShort(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(Math.round(paise / 100));
}

// ----------------------------------------------------------------------------
// Account / category UI metadata
// ----------------------------------------------------------------------------

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  cash: "Cash",
  account: "Accounts",
  card: "Card",
  savings: "Savings",
  other: "Others",
};

export const ACCOUNT_TYPE_ORDER: AccountType[] = [
  "cash",
  "account",
  "card",
  "savings",
  "other",
];

/** Stable colour palette for pie slices and category chips. */
export const PIE_COLORS = [
  "#f97066", // primary coral (matches screenshots)
  "#f6a868", // orange
  "#fdd663", // yellow
  "#7dd3a6", // green
  "#5fb3e8", // blue
  "#a78bfa", // violet
  "#f472b6", // pink
  "#94a3b8", // slate
];

export function colorForIndex(i: number): string {
  return PIE_COLORS[i % PIE_COLORS.length];
}

// ----------------------------------------------------------------------------
// Transaction aggregation
// ----------------------------------------------------------------------------

export type DayTotals = {
  income_paise: number;
  expense_paise: number;
};

export type DayGroup = {
  day: string; // YYYY-MM-DD
  totals: DayTotals;
  rows: FinanceTransaction[];
};

/** Group transactions by `occurred_on`, sorted newest day first. */
export function groupTxByDay(rows: FinanceTransaction[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const r of rows) {
    let g = map.get(r.occurred_on);
    if (!g) {
      g = { day: r.occurred_on, totals: { income_paise: 0, expense_paise: 0 }, rows: [] };
      map.set(r.occurred_on, g);
    }
    g.rows.push(r);
    if (r.kind === "income") g.totals.income_paise += r.amount_paise;
    else if (r.kind === "expense") g.totals.expense_paise += r.amount_paise;
  }
  // Sort rows within each day by occurred_at desc, then by created_at desc.
  for (const g of map.values()) {
    g.rows.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
  }
  return Array.from(map.values()).sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** Sum a list of transactions into income / expense totals (paise). */
export function sumTotals(rows: FinanceTransaction[]): DayTotals {
  const out: DayTotals = { income_paise: 0, expense_paise: 0 };
  for (const r of rows) {
    if (r.kind === "income") out.income_paise += r.amount_paise;
    else if (r.kind === "expense") out.expense_paise += r.amount_paise;
  }
  return out;
}

export type SliceTotal = {
  key: string;
  label: string;
  total_paise: number;
  pct: number;
  color: string;
};

/**
 * Aggregate transactions of a given kind by their top-level category.
 * Subcategory entries roll up into their parent so the slices match the
 * "Chennai 83%, MTP house 17%" view in screenshot 6.
 */
export function sliceByTopCategory(
  rows: FinanceTransaction[],
  kind: "income" | "expense",
  categories: FinanceCategory[]
): SliceTotal[] {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const totals = new Map<string, { label: string; total: number }>();
  let grandTotal = 0;
  for (const r of rows) {
    if (r.kind !== kind || !r.category_id) continue;
    const cat = catMap.get(r.category_id);
    const top = cat?.parent_id ? catMap.get(cat.parent_id) ?? cat : cat;
    const key = top?.id ?? "uncategorised";
    const label = top?.name ?? "Uncategorised";
    const cur = totals.get(key) ?? { label, total: 0 };
    cur.total += r.amount_paise;
    totals.set(key, cur);
    grandTotal += r.amount_paise;
  }
  const sorted = Array.from(totals.entries()).sort(
    (a, b) => b[1].total - a[1].total
  );
  return sorted.map(([key, v], i) => ({
    key,
    label: v.label,
    total_paise: v.total,
    pct: grandTotal === 0 ? 0 : (v.total / grandTotal) * 100,
    color: colorForIndex(i),
  }));
}

/** Aggregate by note text, used by the Note sub-tab (screenshot 7). */
export type NoteBucket = {
  note: string;
  count: number;
  total_paise: number;
};

export function sliceByNote(
  rows: FinanceTransaction[],
  kind: "income" | "expense"
): NoteBucket[] {
  const map = new Map<string, NoteBucket>();
  for (const r of rows) {
    if (r.kind !== kind) continue;
    const key = (r.note ?? "").trim();
    const cur = map.get(key) ?? { note: key, count: 0, total_paise: 0 };
    cur.count += 1;
    cur.total_paise += r.amount_paise;
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count || b.total_paise - a.total_paise);
}

// ----------------------------------------------------------------------------
// Calendar / month math
// ----------------------------------------------------------------------------

export function startOfMonth(year: number, monthZeroBased: number): Date {
  return new Date(year, monthZeroBased, 1);
}

export function endOfMonth(year: number, monthZeroBased: number): Date {
  return new Date(year, monthZeroBased + 1, 0);
}

/** Number of days in the given month (1-based or 0-based — works for both). */
export function daysInMonth(year: number, monthZeroBased: number): number {
  return endOfMonth(year, monthZeroBased).getDate();
}

/** Returns a 6×7 grid of Date objects starting from Sunday. Days outside the
 *  current month are still present (greyed out in the UI), matching screenshot 3. */
export function monthGrid(year: number, monthZeroBased: number): Date[] {
  const first = startOfMonth(year, monthZeroBased);
  const startOffset = first.getDay(); // 0 = Sun
  const start = new Date(year, monthZeroBased, 1 - startOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/** Weekly buckets for the Monthly tab (screenshot 4): 01–07, 08–14, etc. */
export type WeekBucket = {
  label: string; // "01/02 ~ 07/02"
  start: string;
  end: string;
  totals: DayTotals;
};

export function weekBuckets(
  rows: FinanceTransaction[],
  year: number,
  monthZeroBased: number
): WeekBucket[] {
  const dim = daysInMonth(year, monthZeroBased);
  const buckets: WeekBucket[] = [];
  // Weeks at 1–7, 8–14, 15–21, 22–28, 29–end.
  const ranges: Array<[number, number]> = [];
  for (let start = 1; start <= dim; start += 7) {
    ranges.push([start, Math.min(start + 6, dim)]);
  }
  for (const [s, e] of ranges) {
    const startYmd = ymd(new Date(year, monthZeroBased, s));
    const endYmd = ymd(new Date(year, monthZeroBased, e));
    const totals: DayTotals = { income_paise: 0, expense_paise: 0 };
    for (const r of rows) {
      if (r.occurred_on >= startYmd && r.occurred_on <= endYmd) {
        if (r.kind === "income") totals.income_paise += r.amount_paise;
        else if (r.kind === "expense") totals.expense_paise += r.amount_paise;
      }
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    const mm = pad(monthZeroBased + 1);
    buckets.push({
      label: `${pad(s)}/${mm} ~ ${pad(e)}/${mm}`,
      start: startYmd,
      end: endYmd,
      totals,
    });
  }
  return buckets;
}

export const MONTH_LABEL = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

// ----------------------------------------------------------------------------
// Recurrence materialisation
// ----------------------------------------------------------------------------

/** Compute the next due date after `from` for the given frequency / interval. */
export function nextDueDate(from: Date, freq: Frequency, interval: number): Date {
  const d = new Date(from);
  switch (freq) {
    case "daily":
      d.setDate(d.getDate() + interval);
      break;
    case "weekly":
      d.setDate(d.getDate() + 7 * interval);
      break;
    case "monthly":
      d.setMonth(d.getMonth() + interval);
      break;
    case "yearly":
      d.setFullYear(d.getFullYear() + interval);
      break;
  }
  return d;
}

/**
 * For each recurrence, INSERT all due transactions up to `today` and update
 * `last_materialised_on`. Idempotent: re-running for the same day is a no-op.
 */
export async function materialiseDueRecurrences(
  supabase: SupabaseClient,
  userId: string,
  today: Date = new Date()
): Promise<number> {
  const { data: recs, error } = await supabase
    .from("finance_recurrences")
    .select("*")
    .eq("user_id", userId);
  if (error || !recs) return 0;

  const todayYmd = ymd(today);
  let inserted = 0;

  for (const r of recs as FinanceRecurrence[]) {
    if (r.end_on && r.end_on < todayYmd) continue;
    let cursor: Date;
    if (r.last_materialised_on) {
      cursor = nextDueDate(new Date(r.last_materialised_on), r.frequency, r.interval_n);
    } else {
      cursor = new Date(r.start_on);
    }
    const cap = r.end_on ? new Date(r.end_on) : today;
    const upperBound = cap < today ? cap : today;

    const toInsert: Array<Partial<FinanceTransaction>> = [];
    while (ymd(cursor) <= ymd(upperBound)) {
      const t = r.template_json as RecurrenceTemplate;
      toInsert.push({
        user_id: userId,
        kind: t.kind,
        occurred_on: ymd(cursor),
        account_id: t.account_id,
        to_account_id: t.kind === "transfer" ? t.to_account_id ?? null : null,
        category_id: t.kind === "transfer" ? null : t.category_id ?? null,
        amount_paise: t.amount_paise,
        fees_paise: t.fees_paise ?? 0,
        note: t.note ?? null,
        recurrence_id: r.id,
      });
      cursor = nextDueDate(cursor, r.frequency, r.interval_n);
    }

    if (toInsert.length > 0) {
      const { error: insErr } = await supabase
        .from("finance_transactions")
        .insert(toInsert);
      if (!insErr) {
        inserted += toInsert.length;
        await supabase
          .from("finance_recurrences")
          .update({ last_materialised_on: ymd(upperBound) })
          .eq("id", r.id);
      }
    }
  }
  return inserted;
}

// ----------------------------------------------------------------------------
// CSV export
// ----------------------------------------------------------------------------

export type TxCsvRow = {
  occurred_on: string;
  kind: TxKind;
  account: string;
  to_account: string;
  category: string;
  subcategory: string;
  note: string;
  amount: number;
  fees: number;
  recurring: string;
};

export function txToCsvRows(
  rows: FinanceTransaction[],
  accounts: FinanceAccount[],
  categories: FinanceCategory[]
): TxCsvRow[] {
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const cat = new Map(categories.map((c) => [c.id, c]));
  return rows.map((r) => {
    const c = r.category_id ? cat.get(r.category_id) : undefined;
    const parent = c?.parent_id ? cat.get(c.parent_id) : undefined;
    return {
      occurred_on: r.occurred_on,
      kind: r.kind,
      account: acc.get(r.account_id) ?? "",
      to_account: r.to_account_id ? acc.get(r.to_account_id) ?? "" : "",
      category: parent?.name ?? c?.name ?? "",
      subcategory: parent ? c?.name ?? "" : "",
      note: r.note ?? "",
      amount: r.amount_paise / 100,
      fees: r.fees_paise / 100,
      recurring: r.recurrence_id ? "yes" : "",
    };
  });
}
