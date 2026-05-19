import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarRange,
  CalendarDays,
  Pencil,
  PieChart as PieIcon,
  Plus,
} from "lucide-react";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { ymd } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type {
  FinanceBudget,
  FinanceCategory,
  FinanceTransaction,
} from "@/types";
import {
  endOfMonth,
  formatINR,
  rupeesToPaise,
  paiseToRupees,
  sliceByNote,
  sliceByTopCategory,
  startOfMonth,
} from "@/lib/finance";
import { MonthSwitcher } from "@/components/finance/MonthSwitcher";

type SubTab = "stats" | "budget" | "note";
type Side = "income" | "expense";
type FilterMode = "month" | "range";

export function FinanceStatsPage() {
  const { user } = useAuth();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [tab, setTab] = useState<SubTab>("stats");
  const [side, setSide] = useState<Side>("expense");

  // Date filter — either a single month (default) or an arbitrary date range.
  const [filterMode, setFilterMode] = useState<FilterMode>("month");
  const [rangeFrom, setRangeFrom] = useState<string>(
    ymd(startOfMonth(today.getFullYear(), today.getMonth()))
  );
  const [rangeTo, setRangeTo] = useState<string>(
    ymd(endOfMonth(today.getFullYear(), today.getMonth()))
  );

  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [budgets, setBudgets] = useState<FinanceBudget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** The effective from/to date strings used by every query. */
  const { fromDate, toDate } = useMemo(() => {
    if (filterMode === "range") {
      // Defensive ordering — if the user picks To < From, swap so the query
      // still returns something instead of zero rows.
      const a = rangeFrom;
      const b = rangeTo;
      return a <= b
        ? { fromDate: a, toDate: b }
        : { fromDate: b, toDate: a };
    }
    return {
      fromDate: ymd(startOfMonth(year, month)),
      toDate: ymd(endOfMonth(year, month)),
    };
  }, [filterMode, rangeFrom, rangeTo, year, month]);

  // Budget dialog
  const [budgetDialogOpen, setBudgetDialogOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<FinanceBudget | null>(null);
  const [budgetCategoryId, setBudgetCategoryId] = useState<string>("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      // Budgets are inherently per-month; only fetch them when the user is
      // viewing a single month. In range mode we skip the query.
      const budgetMonthFirst =
        filterMode === "month" ? ymd(startOfMonth(year, month)) : null;
      const [{ data: t, error: tErr }, { data: c }, budgetRes] =
        await Promise.all([
          supabase
            .from("finance_transactions")
            .select("*")
            .gte("occurred_on", fromDate)
            .lte("occurred_on", toDate),
          // Include archived: transactions in the period may still reference
          // soft-deleted categories that we still want to label correctly.
          supabase
            .from("finance_categories")
            .select("*")
            .order("position"),
          budgetMonthFirst
            ? supabase
                .from("finance_budgets")
                .select("*")
                .eq("month", budgetMonthFirst)
            : Promise.resolve({ data: [] as FinanceBudget[] }),
        ]);
      if (cancelled) return;
      if (tErr) setError(tErr.message);
      setTransactions((t as FinanceTransaction[]) ?? []);
      setCategories((c as FinanceCategory[]) ?? []);
      setBudgets((budgetRes.data as FinanceBudget[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, fromDate, toDate, filterMode, year, month]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const r of transactions) {
      if (r.kind === "income") income += r.amount_paise;
      else if (r.kind === "expense") expense += r.amount_paise;
    }
    return { income, expense };
  }, [transactions]);

  const slices = useMemo(
    () => sliceByTopCategory(transactions, side, categories),
    [transactions, side, categories]
  );
  const noteBuckets = useMemo(
    () => sliceByNote(transactions, side),
    [transactions, side]
  );

  function openAddBudget() {
    setEditingBudget(null);
    setBudgetCategoryId("");
    setBudgetAmount("");
    setBudgetDialogOpen(true);
  }
  function openEditBudget(b: FinanceBudget) {
    setEditingBudget(b);
    setBudgetCategoryId(b.category_id ?? "");
    setBudgetAmount(String(paiseToRupees(b.amount_paise)));
    setBudgetDialogOpen(true);
  }

  async function handleSaveBudget(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const paise = rupeesToPaise(budgetAmount);
    if (paise === null || paise < 0) {
      setError("Enter a valid amount.");
      return;
    }
    setBusy(true);
    const monthFirst = ymd(startOfMonth(year, month));
    if (editingBudget) {
      const { data, error: err } = await supabase
        .from("finance_budgets")
        .update({ amount_paise: paise })
        .eq("id", editingBudget.id)
        .select()
        .single();
      if (err) setError(err.message);
      else if (data)
        setBudgets((cur) =>
          cur.map((b) => (b.id === editingBudget.id ? (data as FinanceBudget) : b))
        );
    } else {
      const { data, error: err } = await supabase
        .from("finance_budgets")
        .insert({
          user_id: user.id,
          category_id: budgetCategoryId || null,
          month: monthFirst,
          amount_paise: paise,
        })
        .select()
        .single();
      if (err) setError(err.message);
      else if (data) setBudgets((cur) => [...cur, data as FinanceBudget]);
    }
    setBusy(false);
    setBudgetDialogOpen(false);
  }

  async function handleDeleteBudget(b: FinanceBudget) {
    setBusy(true);
    const { error: err } = await supabase
      .from("finance_budgets")
      .delete()
      .eq("id", b.id);
    setBusy(false);
    if (err) setError(err.message);
    else setBudgets((cur) => cur.filter((x) => x.id !== b.id));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stats"
        description="Visualise where the money goes — pie chart by category, monthly budgets, and notes."
        icon={<PieIcon className="h-5 w-5" />}
      />

      {/* Date filter — Month (single month) or Range (arbitrary from→to). */}
      <div className="space-y-3">
        <div className="inline-flex rounded-md border bg-card p-0.5 text-xs">
          {(
            [
              { value: "month", label: "Month", icon: CalendarDays },
              { value: "range", label: "Date range", icon: CalendarRange },
            ] as Array<{ value: FilterMode; label: string; icon: typeof CalendarDays }>
          ).map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilterMode(value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 transition-colors",
                filterMode === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {filterMode === "month" ? (
          <MonthSwitcher
            year={year}
            month={month}
            onChange={(y, m) => {
              setYear(y);
              setMonth(m);
            }}
          />
        ) : (
          <RangeFilter
            from={rangeFrom}
            to={rangeTo}
            onChange={(f, t) => {
              setRangeFrom(f);
              setRangeTo(t);
            }}
          />
        )}
      </div>

      {/* Sub-tabs */}
      <div className="inline-flex rounded-md border bg-card p-0.5 text-sm">
        {(["stats", "budget", "note"] as SubTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-sm px-4 py-1.5 capitalize transition-colors",
              tab === t
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Income / Expense toggle */}
      <div className="flex border-b text-sm">
        {(["income", "expense"] as Side[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={cn(
              "flex-1 px-4 py-2 -mb-px border-b-2 transition-colors text-left",
              side === s
                ? s === "income"
                  ? "border-sky-500 text-foreground"
                  : "border-rose-500 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <span className="text-xs text-muted-foreground mr-2 capitalize">
              {s === "income" ? "Income" : "Exp."}
            </span>
            <span
              className={cn(
                "font-semibold",
                s === "income" ? "text-sky-500" : "text-rose-500"
              )}
            >
              {formatINR(s === "income" ? totals.income : totals.expense)}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm text-rose-500" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <SkeletonList rows={4} />
      ) : tab === "stats" ? (
        <StatsTab slices={slices} side={side} />
      ) : tab === "budget" ? (
        filterMode === "range" ? (
          <EmptyState
            icon={<BarChart3 className="h-6 w-6" />}
            title="Budgets are monthly"
            description="Switch to the Month filter above to set or view monthly limits."
          />
        ) : (
          <BudgetTab
            budgets={budgets}
            categories={categories}
            transactions={transactions}
            side={side}
            onAdd={openAddBudget}
            onEdit={openEditBudget}
            onDelete={handleDeleteBudget}
            busy={busy}
          />
        )
      ) : (
        <NoteTab buckets={noteBuckets} />
      )}

      {/* Budget dialog */}
      <Dialog
        open={budgetDialogOpen}
        onClose={() => setBudgetDialogOpen(false)}
        title={editingBudget ? "Edit budget" : "Add budget"}
      >
        <form onSubmit={handleSaveBudget} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="b-cat">Category</Label>
            <Select
              id="b-cat"
              value={budgetCategoryId}
              onChange={(e) => setBudgetCategoryId(e.target.value)}
              disabled={!!editingBudget}
            >
              <option value="">Overall (all categories)</option>
              {categories
                .filter((c) => !c.parent_id && !c.archived_at)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-amount">Monthly limit (₹)</Label>
            <Input
              id="b-amount"
              inputMode="decimal"
              value={budgetAmount}
              onChange={(e) => setBudgetAmount(e.target.value)}
              placeholder="0.00"
              required
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setBudgetDialogOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {editingBudget ? "Save" : "Add"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Range filter — From / To date inputs with quick presets
// ---------------------------------------------------------------------------

function RangeFilter({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const now = new Date();
  const presets: Array<{ label: string; from: string; to: string }> = [
    {
      label: "This month",
      from: ymd(startOfMonth(now.getFullYear(), now.getMonth())),
      to: ymd(endOfMonth(now.getFullYear(), now.getMonth())),
    },
    {
      label: "Last 3 months",
      from: ymd(startOfMonth(now.getFullYear(), now.getMonth() - 2)),
      to: ymd(endOfMonth(now.getFullYear(), now.getMonth())),
    },
    {
      label: "Last 6 months",
      from: ymd(startOfMonth(now.getFullYear(), now.getMonth() - 5)),
      to: ymd(endOfMonth(now.getFullYear(), now.getMonth())),
    },
    {
      label: "This year",
      from: ymd(new Date(now.getFullYear(), 0, 1)),
      to: ymd(new Date(now.getFullYear(), 11, 31)),
    },
  ];
  const rangeInvalid = from > to;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr,1fr] gap-2">
        <div className="space-y-1">
          <Label htmlFor="range-from">From</Label>
          <Input
            id="range-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => onChange(e.target.value || from, to)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="range-to">To</Label>
          <Input
            id="range-to"
            type="date"
            value={to}
            min={from}
            onChange={(e) => onChange(from, e.target.value || to)}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((p) => {
          const active = from === p.from && to === p.to;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(p.from, p.to)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {rangeInvalid && (
        <p className="text-xs text-amber-600">
          From date is after To date — they'll be swapped automatically.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats sub-tab — pie chart + legend
// ---------------------------------------------------------------------------

function StatsTab({
  slices,
  side,
}: {
  slices: ReturnType<typeof sliceByTopCategory>;
  side: Side;
}) {
  if (slices.length === 0) {
    return (
      <EmptyState
        icon={<PieIcon className="h-6 w-6" />}
        title="No data available."
        description={`Add ${side === "income" ? "income" : "expense"} transactions to see the breakdown.`}
      />
    );
  }
  const data = slices.map((s) => ({ name: s.label, value: s.total_paise / 100 }));
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                stroke="none"
                label={({ percent }) =>
                  percent && percent > 0.04 ? `${(percent * 100).toFixed(1)}%` : ""
                }
                labelLine={false}
              >
                {slices.map((s) => (
                  <Cell key={s.key} fill={s.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v: number) => formatINR(Math.round(v * 100))}
              />
              <Legend
                verticalAlign="bottom"
                wrapperStyle={{ fontSize: "12px" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {slices.map((s) => (
              <li
                key={s.key}
                className="flex items-center gap-3 px-5 py-3 text-sm"
              >
                <span
                  className="inline-flex items-center justify-center rounded px-2 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: `${s.color}33`,
                    color: s.color,
                  }}
                >
                  {s.pct.toFixed(0)}%
                </span>
                <span className="flex-1 truncate">{s.label}</span>
                <span className="font-semibold">{formatINR(s.total_paise)}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Budget sub-tab
// ---------------------------------------------------------------------------

function BudgetTab({
  budgets,
  categories,
  transactions,
  side,
  onAdd,
  onEdit,
  onDelete,
  busy,
}: {
  budgets: FinanceBudget[];
  categories: FinanceCategory[];
  transactions: FinanceTransaction[];
  side: Side;
  onAdd: () => void;
  onEdit: (b: FinanceBudget) => void;
  onDelete: (b: FinanceBudget) => void | Promise<void>;
  busy: boolean;
}) {
  if (side === "income") {
    return (
      <EmptyState
        icon={<BarChart3 className="h-6 w-6" />}
        title="Budgets apply to expenses"
        description="Switch to the Exp. tab to set and view monthly limits."
      />
    );
  }
  // Spent map: top-level category id -> sum
  const spentByCat = useMemo(() => {
    const catMap = new Map(categories.map((c) => [c.id, c]));
    const totals = new Map<string, number>();
    let overall = 0;
    for (const t of transactions) {
      if (t.kind !== "expense") continue;
      overall += t.amount_paise;
      if (!t.category_id) continue;
      const cat = catMap.get(t.category_id);
      const topId = cat?.parent_id ?? cat?.id;
      if (!topId) continue;
      totals.set(topId, (totals.get(topId) ?? 0) + t.amount_paise);
    }
    return { byTop: totals, overall };
  }, [transactions, categories]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={onAdd}>
          <Plus className="h-4 w-4" /> Add budget
        </Button>
      </div>
      {budgets.length === 0 ? (
        <EmptyState
          icon={<BarChart3 className="h-6 w-6" />}
          title="No budgets for this month"
          description="Add a monthly limit per category to track spending."
          action={
            <Button onClick={onAdd}>
              <Plus className="h-4 w-4" /> Add budget
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {budgets.map((b) => {
                const cat = b.category_id
                  ? categories.find((c) => c.id === b.category_id)
                  : undefined;
                const spent = b.category_id
                  ? spentByCat.byTop.get(b.category_id) ?? 0
                  : spentByCat.overall;
                const pct =
                  b.amount_paise === 0
                    ? 0
                    : Math.min(100, (spent / b.amount_paise) * 100);
                const over = spent > b.amount_paise;
                return (
                  <li key={b.id} className="px-5 py-4 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {cat?.name ?? "Overall (all expenses)"}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onEdit(b)}
                          aria-label="Edit budget"
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDelete(b)}
                          disabled={busy}
                          aria-label="Delete budget"
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          "h-full transition-all",
                          over ? "bg-rose-500" : "bg-primary"
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className={over ? "text-rose-500" : "text-muted-foreground"}>
                        {formatINR(spent)} of {formatINR(b.amount_paise)}
                      </span>
                      <span className="text-muted-foreground">
                        {pct.toFixed(0)}%{over && " · over"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Note sub-tab
// ---------------------------------------------------------------------------

function NoteTab({
  buckets,
}: {
  buckets: ReturnType<typeof sliceByNote>;
}) {
  if (buckets.length === 0) {
    return (
      <EmptyState
        icon={<PieIcon className="h-6 w-6" />}
        title="No notes in this period"
        description="Add a note to your transactions to group them here."
      />
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <div className="grid grid-cols-[1fr,60px,120px] gap-3 px-5 py-3 border-b text-xs uppercase text-muted-foreground">
          <span>Note</span>
          <span className="text-right">Count</span>
          <span className="text-right">Amount</span>
        </div>
        <ul className="divide-y text-sm">
          {buckets.map((b) => (
            <li
              key={b.note || "(no note)"}
              className="grid grid-cols-[1fr,60px,120px] gap-3 px-5 py-3 items-center"
            >
              <span className="truncate text-foreground">
                {b.note || (
                  <span className="text-muted-foreground italic">(no note)</span>
                )}
              </span>
              <span className="text-right text-muted-foreground">{b.count}</span>
              <span className="text-right font-medium">
                {formatINR(b.total_paise)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
