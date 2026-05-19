import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Receipt,
  Trash2,
  FileUp,
  Wallet,
  CalendarDays,
  CalendarRange,
  ChevronDown,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { ExportButton } from "@/components/ui/ExportButton";
import { exportReport } from "@/lib/export";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { ymd } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type {
  AccountType,
  CategoryKind,
  FinanceAccount,
  FinanceCategory,
  FinanceTransaction,
  RecurrenceTemplate,
} from "@/types";
import {
  daysInMonth,
  endOfMonth,
  formatINR,
  formatRupeesShort,
  groupTxByDay,
  materialiseDueRecurrences,
  monthGrid,
  MONTH_LABEL,
  startOfMonth,
  sumTotals,
  txToCsvRows,
  weekBuckets,
} from "@/lib/finance";
import {
  TransactionDialog,
  type TxDraft,
} from "@/components/finance/TransactionDialog";
import { MonthSwitcher } from "@/components/finance/MonthSwitcher";
import { ImportStatementDialog } from "@/components/finance/ImportStatementDialog";

type Tab = "daily" | "calendar" | "monthly";
type FilterMode = "month" | "range";

const TAB_LABEL: Record<Tab, string> = {
  daily: "Daily",
  calendar: "Calendar",
  monthly: "Monthly",
};

export function FinanceTransactionsPage() {
  const { user } = useAuth();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [tab, setTab] = useState<Tab>("daily");

  // Date filter — single month (default) or arbitrary date range.
  const [filterMode, setFilterMode] = useState<FilterMode>("month");
  const [rangeFrom, setRangeFrom] = useState<string>(
    ymd(startOfMonth(today.getFullYear(), today.getMonth()))
  );
  const [rangeTo, setRangeTo] = useState<string>(
    ymd(endOfMonth(today.getFullYear(), today.getMonth()))
  );

  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [yearTx, setYearTx] = useState<FinanceTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FinanceTransaction | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<FinanceTransaction | null>(null);
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [dayDialogKey, setDayDialogKey] = useState<string | null>(null);

  // Load accounts + categories once.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [{ data: a }, { data: c }] = await Promise.all([
        supabase
          .from("finance_accounts")
          .select("*")
          .is("archived_at", null)
          .order("position"),
        // Intentionally load archived categories too: existing transactions
        // may still reference an archived (soft-deleted) category and need its
        // name for display. Pickers filter `archived_at` out at the UI layer.
        supabase
          .from("finance_categories")
          .select("*")
          .order("position"),
      ]);
      if (cancelled) return;
      setAccounts((a as FinanceAccount[]) ?? []);
      setCategories((c as FinanceCategory[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Materialise recurrences once per session per user.
  useEffect(() => {
    if (!user) return;
    void materialiseDueRecurrences(supabase, user.id);
  }, [user]);

  /** Effective from/to date strings used by the primary transactions query. */
  const { fromDate, toDate } = useMemo(() => {
    if (filterMode === "range") {
      // Defensive ordering — swap if user picked To < From.
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

  // Calendar / Monthly views assume a single month / single year respectively,
  // so in range mode auto-switch to Daily which is range-aware.
  useEffect(() => {
    if (filterMode === "range" && tab !== "daily") setTab("daily");
  }, [filterMode, tab]);

  // Load transactions for the filter window, plus a year of data when needed.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const yearStart = ymd(new Date(year, 0, 1));
      const yearEnd = ymd(new Date(year, 11, 31));

      const { data: m, error: mErr } = await supabase
        .from("finance_transactions")
        .select("*")
        .gte("occurred_on", fromDate)
        .lte("occurred_on", toDate)
        .order("occurred_on", { ascending: false })
        .order("occurred_at", { ascending: false });
      if (cancelled) return;
      if (mErr) {
        setError(mErr.message);
        setLoading(false);
        return;
      }
      setTransactions((m as FinanceTransaction[]) ?? []);

      if (filterMode === "month" && tab === "monthly") {
        const { data: y } = await supabase
          .from("finance_transactions")
          .select("*")
          .gte("occurred_on", yearStart)
          .lte("occurred_on", yearEnd);
        if (cancelled) return;
        setYearTx((y as FinanceTransaction[]) ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, fromDate, toDate, filterMode, year, tab]);

  const monthTotals = useMemo(() => sumTotals(transactions), [transactions]);
  const dayGroups = useMemo(() => groupTxByDay(transactions), [transactions]);

  async function handleSave(draft: TxDraft) {
    if (!user) return;
    setBusy(true);
    setError(null);

    let recurrenceId: string | null = null;
    if (!editing && draft.recurrence) {
      const template: RecurrenceTemplate = {
        kind: draft.kind,
        account_id: draft.account_id,
        to_account_id: draft.to_account_id,
        category_id: draft.category_id,
        amount_paise: draft.amount_paise,
        fees_paise: draft.fees_paise,
        note: draft.note || null,
      };
      const { data: rec, error: rErr } = await supabase
        .from("finance_recurrences")
        .insert({
          user_id: user.id,
          template_json: template,
          frequency: draft.recurrence.frequency,
          interval_n: draft.recurrence.interval_n,
          start_on: draft.occurred_on,
          end_on: draft.recurrence.end_on,
          last_materialised_on: draft.occurred_on,
        })
        .select()
        .single();
      if (rErr) {
        setError(rErr.message);
        setBusy(false);
        return;
      }
      recurrenceId = rec.id;
    }

    const row = {
      user_id: user.id,
      kind: draft.kind,
      occurred_on: draft.occurred_on,
      account_id: draft.account_id,
      to_account_id: draft.to_account_id,
      category_id: draft.category_id,
      amount_paise: draft.amount_paise,
      fees_paise: draft.fees_paise,
      note: draft.note || null,
      recurrence_id: recurrenceId,
    };
    if (editing) {
      const { data, error: err } = await supabase
        .from("finance_transactions")
        .update(row)
        .eq("id", editing.id)
        .select()
        .single();
      if (err) {
        setError(err.message);
      } else if (data) {
        const updated = data as FinanceTransaction;
        setTransactions((cur) =>
          cur.map((t) => (t.id === updated.id ? updated : t))
        );
      }
    } else {
      const { data, error: err } = await supabase
        .from("finance_transactions")
        .insert(row)
        .select()
        .single();
      if (err) setError(err.message);
      else if (data) setTransactions((cur) => [data as FinanceTransaction, ...cur]);
    }
    setBusy(false);
    setDialogOpen(false);
    setEditing(null);
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    const { error: err } = await supabase
      .from("finance_transactions")
      .delete()
      .eq("id", confirmDelete.id);
    setBusy(false);
    if (err) {
      setError(err.message);
      setConfirmDelete(null);
      return;
    }
    setTransactions((cur) => cur.filter((t) => t.id !== confirmDelete.id));
    setConfirmDelete(null);
  }

  const exportRows = useMemo(
    () => txToCsvRows(transactions, accounts, categories),
    [transactions, accounts, categories]
  );

  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts]
  );
  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

  const noAccounts = accounts.length === 0;

  /** Shared inline-create handler for accounts. Used by both the import
   *  dialog and the regular transaction dialog. */
  async function createAccount(input: {
    name: string;
    account_type: AccountType;
  }): Promise<FinanceAccount> {
    if (!user) throw new Error("Not signed in.");
    const trimmed = input.name.trim();
    const key = trimmed.toLowerCase();
    const dup = accounts.find((a) => a.name.trim().toLowerCase() === key);
    if (dup) throw new Error(`An account named "${dup.name}" already exists.`);
    const { data, error: err } = await supabase
      .from("finance_accounts")
      .insert({
        user_id: user.id,
        name: trimmed,
        account_type: input.account_type,
        position: accounts.length,
      })
      .select()
      .single();
    if (err) throw new Error(err.message);
    const created = data as FinanceAccount;
    setAccounts((cur) => [...cur, created]);
    return created;
  }

  /** Shared inline-create handler for top-level + sub categories.
   *  Categories are shared across income and expense — `kind` is no longer
   *  used to scope visibility, but the DB CHECK still requires the column to
   *  be 'income' or 'expense', so we just pass whatever the caller provides
   *  (typically the sentinel "expense"). */
  async function createCategory(input: {
    name: string;
    kind: CategoryKind;
    parent_id: string | null;
  }): Promise<FinanceCategory> {
    if (!user) throw new Error("Not signed in.");
    const trimmed = input.name.trim();
    const key = trimmed.toLowerCase();
    // Compute a sensible position — append to the end of the relevant sibling
    // set so the new row shows up last in any ordered list.
    const siblings = categories.filter(
      (c) =>
        !c.archived_at && (c.parent_id ?? null) === (input.parent_id ?? null)
    );
    const dup = siblings.find((c) => c.name.trim().toLowerCase() === key);
    if (dup) {
      const scope = input.parent_id ? "subcategory" : "category";
      throw new Error(`A ${scope} named "${dup.name}" already exists.`);
    }
    const { data, error: err } = await supabase
      .from("finance_categories")
      .insert({
        user_id: user.id,
        name: trimmed,
        kind: input.kind,
        parent_id: input.parent_id,
        position: siblings.length,
      })
      .select()
      .single();
    if (err) throw new Error(err.message);
    const created = data as FinanceCategory;
    setCategories((cur) => [...cur, created]);
    return created;
  }

  return (
    <div className="space-y-6 relative pb-24">
      <PageHeader
        title="Transactions"
        description="Track income, expenses, and transfers across your accounts."
        icon={<Receipt className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <ExportButton
              onExport={(format) =>
                exportReport({
                  name: `finance-${year}-${String(month + 1).padStart(2, "0")}`,
                  format,
                  rows: exportRows,
                  columns: [
                    "occurred_on",
                    "kind",
                    "account",
                    "to_account",
                    "category",
                    "subcategory",
                    "note",
                    "amount",
                    "fees",
                    "recurring",
                  ],
                })
              }
              disabled={exportRows.length === 0}
            />
            <Button
              variant="outline"
              onClick={() => setImportOpen(true)}
              title={
                noAccounts
                  ? "Import a PDF — we'll create an account for it"
                  : "Import PDF bank statement"
              }
            >
              <FileUp className="h-4 w-4" /> Import
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              disabled={noAccounts}
              title={noAccounts ? "Add an account first" : undefined}
            >
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        }
      />

      {noAccounts && (
        <div
          role="status"
          className="flex flex-wrap items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
        >
          <Wallet className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground">
              No accounts yet — Add is disabled.
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Create one on the{" "}
              <Link
                to="/finance/accounts"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Accounts page
              </Link>
              , or just{" "}
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                className="underline underline-offset-2 hover:text-foreground"
              >
                import a PDF statement
              </button>{" "}
              — we'll auto-detect the bank and create the account for you.
            </p>
          </div>
        </div>
      )}

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
            yearOnly={tab === "monthly"}
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
      <div className="flex border-b text-sm">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => {
          const disabled = filterMode === "range" && t !== "daily";
          return (
            <button
              key={t}
              type="button"
              onClick={() => !disabled && setTab(t)}
              disabled={disabled}
              title={disabled ? "Switch to Month filter to use this view" : undefined}
              className={cn(
                "px-4 py-2 -mb-px border-b-2 transition-colors",
                tab === t
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
                disabled && "opacity-40 cursor-not-allowed hover:text-muted-foreground"
              )}
            >
              {TAB_LABEL[t]}
            </button>
          );
        })}
      </div>

      {/* Summary band */}
      <Card>
        <CardContent className="p-4 grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-xs text-muted-foreground">Income</div>
            <div className="text-sky-500 font-semibold">
              {formatINR(monthTotals.income_paise)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Exp.</div>
            <div className="text-rose-500 font-semibold">
              {formatINR(monthTotals.expense_paise)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="font-semibold">
              {formatINR(monthTotals.income_paise - monthTotals.expense_paise)}
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <p className="text-sm text-rose-500" role="alert">
          {error}
        </p>
      )}

      {/* Tab content */}
      {loading ? (
        <SkeletonList rows={4} />
      ) : tab === "daily" ? (
        dayGroups.length === 0 ? (
          <EmptyState
            icon={<Receipt className="h-6 w-6" />}
            title="No data available."
            description="Tap Add to log your first transaction for this month."
          />
        ) : (
          <div className="space-y-3">
            {dayGroups.map((g) => (
              <Card key={g.day}>
                <CardContent className="p-0">
                  <DayHeader
                    day={g.day}
                    incomePaise={g.totals.income_paise}
                    expensePaise={g.totals.expense_paise}
                  />
                  <ul className="divide-y">
                    {g.rows.map((r) => (
                      <TxRow
                        key={r.id}
                        tx={r}
                        accountName={accountById.get(r.account_id)?.name ?? "—"}
                        toAccountName={
                          r.to_account_id
                            ? accountById.get(r.to_account_id)?.name ?? "—"
                            : null
                        }
                        category={
                          r.category_id
                            ? categoryById.get(r.category_id) ?? null
                            : null
                        }
                        parentCategoryName={
                          r.category_id
                            ? categoryById.get(
                                categoryById.get(r.category_id)?.parent_id ??
                                  r.category_id
                              )?.name ?? null
                            : null
                        }
                        onEdit={() => {
                          setEditing(r);
                          setDialogOpen(true);
                        }}
                        onDelete={() => setConfirmDelete(r)}
                      />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : tab === "calendar" ? (
        <CalendarView
          year={year}
          month={month}
          transactions={transactions}
          onDayClick={(key) => setDayDialogKey(key)}
        />
      ) : (
        <MonthlyView year={year} transactions={yearTx} />
      )}

      {/* Floating Add button (mobile pattern) */}
      <button
        type="button"
        onClick={() => {
          setEditing(null);
          setDialogOpen(true);
        }}
        disabled={noAccounts}
        aria-label="Add transaction"
        className={cn(
          "md:hidden fixed bottom-6 right-6 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg",
          "flex items-center justify-center hover:scale-105 transition disabled:opacity-50"
        )}
      >
        <Plus className="h-6 w-6" />
      </button>

      <TransactionDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        accounts={accounts}
        categories={categories}
        initial={editing}
        onSave={handleSave}
        busy={busy}
        createAccount={createAccount}
        createCategory={createCategory}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete transaction?"
        description={
          confirmDelete
            ? `${formatINR(confirmDelete.amount_paise)} on ${confirmDelete.occurred_on}`
            : ""
        }
        destructive
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(null)}
        busy={busy}
      />
      <DayDetailDialog
        dayKey={dayDialogKey}
        transactions={transactions}
        accountById={accountById}
        categoryById={categoryById}
        onClose={() => setDayDialogKey(null)}
        onEdit={(t) => {
          setDayDialogKey(null);
          setEditing(t);
          setDialogOpen(true);
        }}
        onDelete={(t) => {
          setDayDialogKey(null);
          setConfirmDelete(t);
        }}
      />
      <ImportStatementDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        accounts={accounts}
        categories={categories}
        fetchExistingInRange={async (acctId, fromDate, toDate) => {
          const { data, error: err } = await supabase
            .from("finance_transactions")
            .select("*")
            .eq("account_id", acctId)
            .gte("occurred_on", fromDate)
            .lte("occurred_on", toDate);
          if (err) throw new Error(err.message);
          return (data as FinanceTransaction[]) ?? [];
        }}
        insertRows={async (rows) => {
          if (!user) return [];
          const payload = rows.map((r) => ({
            user_id: user.id,
            kind: r.kind,
            occurred_on: r.occurred_on,
            account_id: r.account_id,
            to_account_id: null,
            category_id: r.category_id,
            amount_paise: r.amount_paise,
            fees_paise: 0,
            note: r.note,
          }));
          const { data, error: err } = await supabase
            .from("finance_transactions")
            .insert(payload)
            .select();
          if (err) throw new Error(err.message);
          return (data as FinanceTransaction[]) ?? [];
        }}
        createAccount={createAccount}
        onImported={(inserted) => {
          if (inserted.length === 0) return;
          const monthStartStr = ymd(startOfMonth(year, month));
          const monthEndStr = ymd(endOfMonth(year, month));
          const inMonth = inserted.filter(
            (t) =>
              t.occurred_on >= monthStartStr && t.occurred_on <= monthEndStr
          );
          if (inMonth.length > 0) {
            // Prepend rows that fall in the current month view.
            setTransactions((cur) =>
              [...inMonth, ...cur].sort((a, b) =>
                b.occurred_on.localeCompare(a.occurred_on)
              )
            );
            return;
          }
          // None of the imported rows fall in the current month — jump the
          // view to the earliest imported row's month so the user actually
          // sees what landed (otherwise the dialog closes with no visible
          // change and it looks like the import silently failed).
          const earliest = inserted
            .map((t) => t.occurred_on)
            .sort()[0];
          const [yStr, mStr] = earliest.split("-");
          const newYear = Number(yStr);
          const newMonth = Number(mStr) - 1;
          if (
            Number.isFinite(newYear) &&
            Number.isFinite(newMonth) &&
            (newYear !== year || newMonth !== month)
          ) {
            setYear(newYear);
            setMonth(newMonth);
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function DayHeader({
  day,
  incomePaise,
  expensePaise,
}: {
  day: string;
  incomePaise: number;
  expensePaise: number;
}) {
  const d = new Date(day);
  const wd = WEEKDAY[d.getDay()];
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b text-sm">
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold">{d.getDate()}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {wd}
        </span>
      </div>
      <div className="flex items-center gap-4 text-xs">
        {incomePaise > 0 && (
          <span className="text-sky-500">{formatINR(incomePaise)}</span>
        )}
        {expensePaise > 0 && (
          <span className="text-rose-500">{formatINR(expensePaise)}</span>
        )}
      </div>
    </div>
  );
}

function TxRow({
  tx,
  accountName,
  toAccountName,
  category,
  parentCategoryName,
  onEdit,
  onDelete,
}: {
  tx: FinanceTransaction;
  accountName: string;
  toAccountName: string | null;
  category: FinanceCategory | null;
  parentCategoryName: string | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const amountClass =
    tx.kind === "income"
      ? "text-sky-500"
      : tx.kind === "expense"
      ? "text-rose-500"
      : "text-foreground";
  const subCatName =
    category && parentCategoryName !== category.name ? category.name : null;
  return (
    <li className="grid grid-cols-[140px,140px,1fr,auto,auto] gap-3 px-5 py-3 items-center text-sm">
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground truncate">
          {parentCategoryName ?? (tx.kind === "transfer" ? "Transfer" : "—")}
        </div>
        {subCatName && (
          <div className="text-sm font-medium truncate">{subCatName}</div>
        )}
      </div>
      <div className="min-w-0 text-xs text-muted-foreground truncate">
        {tx.kind === "transfer" && toAccountName
          ? `${accountName} → ${toAccountName}`
          : accountName}
      </div>
      <div className="min-w-0 text-center font-medium truncate">
        {tx.note?.trim() || (tx.kind === "transfer" ? "Transfer" : "—")}
      </div>
      <div className={cn("font-semibold whitespace-nowrap", amountClass)}>
        {formatINR(tx.amount_paise)}
      </div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          ✎
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

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
          <Label htmlFor="tx-range-from">From</Label>
          <Input
            id="tx-range-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => onChange(e.target.value || from, to)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tx-range-to">To</Label>
          <Input
            id="tx-range-to"
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

function DayDetailDialog({
  dayKey,
  transactions,
  accountById,
  categoryById,
  onClose,
  onEdit,
  onDelete,
}: {
  dayKey: string | null;
  transactions: FinanceTransaction[];
  accountById: Map<string, FinanceAccount>;
  categoryById: Map<string, FinanceCategory>;
  onClose: () => void;
  onEdit: (t: FinanceTransaction) => void;
  onDelete: (t: FinanceTransaction) => void;
}) {
  const rows = useMemo(
    () =>
      dayKey
        ? transactions
            .filter((t) => t.occurred_on === dayKey)
            .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
        : [],
    [dayKey, transactions]
  );

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of rows) {
      if (t.kind === "income") income += t.amount_paise;
      else if (t.kind === "expense") expense += t.amount_paise;
    }
    return { income, expense };
  }, [rows]);

  if (!dayKey) return null;

  const d = new Date(dayKey);
  const title = d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <Dialog open={!!dayKey} onClose={onClose} title={title}>
      {rows.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-6 w-6" />}
          title="No transactions on this day."
          description="Pick another day or tap Add to log one."
        />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-end gap-4 text-xs">
            {totals.income > 0 && (
              <span className="text-sky-500">{formatINR(totals.income)}</span>
            )}
            {totals.expense > 0 && (
              <span className="text-rose-500">{formatINR(totals.expense)}</span>
            )}
          </div>
          <ul className="divide-y rounded-md border">
            {rows.map((r) => (
              <TxRow
                key={r.id}
                tx={r}
                accountName={accountById.get(r.account_id)?.name ?? "—"}
                toAccountName={
                  r.to_account_id
                    ? accountById.get(r.to_account_id)?.name ?? "—"
                    : null
                }
                category={
                  r.category_id ? categoryById.get(r.category_id) ?? null : null
                }
                parentCategoryName={
                  r.category_id
                    ? categoryById.get(
                        categoryById.get(r.category_id)?.parent_id ??
                          r.category_id
                      )?.name ?? null
                    : null
                }
                onEdit={() => onEdit(r)}
                onDelete={() => onDelete(r)}
              />
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

function CalendarView({
  year,
  month,
  transactions,
  onDayClick,
}: {
  year: number;
  month: number;
  transactions: FinanceTransaction[];
  onDayClick: (key: string) => void;
}) {
  const grid = monthGrid(year, month);
  const byDay = useMemo(() => {
    const m = new Map<string, { income: number; expense: number }>();
    for (const t of transactions) {
      const cur = m.get(t.occurred_on) ?? { income: 0, expense: 0 };
      if (t.kind === "income") cur.income += t.amount_paise;
      else if (t.kind === "expense") cur.expense += t.amount_paise;
      m.set(t.occurred_on, cur);
    }
    return m;
  }, [transactions]);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="grid grid-cols-7 text-[11px] uppercase text-muted-foreground border-b">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
            <div
              key={d}
              className={cn(
                "px-2 py-2 text-center",
                i === 0 && "text-rose-500",
                i === 6 && "text-sky-500"
              )}
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {grid.map((d) => {
            const inMonth = d.getMonth() === month;
            const key = ymd(d);
            const sums = byDay.get(key);
            const isWeekStart = d.getDay() === 0;
            const isWeekEnd = d.getDay() === 6;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onDayClick(key)}
                className={cn(
                  "min-h-[80px] border-r border-b last:border-r-0 p-1.5 text-xs text-left",
                  "hover:bg-accent/40 focus:outline-none focus:ring-1 focus:ring-ring",
                  !inMonth && "opacity-30"
                )}
              >
                <div
                  className={cn(
                    "font-medium",
                    isWeekStart && inMonth && "text-rose-500",
                    isWeekEnd && inMonth && "text-sky-500"
                  )}
                >
                  {d.getDate()}
                </div>
                {sums && (
                  <div className="mt-1 space-y-0.5">
                    {sums.income > 0 && (
                      <div className="text-sky-500">
                        {formatRupeesShort(sums.income)}
                      </div>
                    )}
                    {sums.expense > 0 && (
                      <div className="text-rose-500">
                        {formatRupeesShort(sums.expense)}
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function MonthlyView({
  year,
  transactions,
}: {
  year: number;
  transactions: FinanceTransaction[];
}) {
  // Aggregate income/expense per month + collect the rows for lazy week
  // computation. The week buckets are NOT computed here — they're built only
  // when a month is expanded, so 12 months stay cheap on initial render.
  const byMonth = useMemo(() => {
    const m: Array<{ income: number; expense: number; rows: FinanceTransaction[] }> =
      Array.from({ length: 12 }, () => ({ income: 0, expense: 0, rows: [] }));
    for (const t of transactions) {
      const idx = new Date(t.occurred_on).getMonth();
      m[idx].rows.push(t);
      if (t.kind === "income") m[idx].income += t.amount_paise;
      else if (t.kind === "expense") m[idx].expense += t.amount_paise;
    }
    return m;
  }, [transactions]);

  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  function toggle(i: number) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {byMonth.map((mObj, i) => (
        <MonthRow
          key={i}
          monthIndex={i}
          year={year}
          income={mObj.income}
          expense={mObj.expense}
          rows={mObj.rows}
          open={expanded.has(i)}
          onToggle={() => toggle(i)}
        />
      ))}
    </div>
  );
}

function MonthRow({
  monthIndex,
  year,
  income,
  expense,
  rows,
  open,
  onToggle,
}: {
  monthIndex: number;
  year: number;
  income: number;
  expense: number;
  rows: FinanceTransaction[];
  open: boolean;
  onToggle: () => void;
}) {
  const dim = daysInMonth(year, monthIndex);
  // Lazy: only compute week buckets while the row is open.
  const weeks = useMemo(
    () => (open ? weekBuckets(rows, year, monthIndex) : []),
    [open, rows, year, monthIndex]
  );
  return (
    <Card>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-accent/40 transition-colors"
        >
          <div className="flex items-center gap-2">
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                open && "rotate-180"
              )}
            />
            <div>
              <div className="font-semibold">{MONTH_LABEL[monthIndex]}</div>
              <div className="text-xs text-muted-foreground">
                01/{String(monthIndex + 1).padStart(2, "0")} ~{" "}
                {String(dim).padStart(2, "0")}/
                {String(monthIndex + 1).padStart(2, "0")}
              </div>
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="text-sky-500">{formatINR(income)}</div>
            <div className="text-rose-500">{formatINR(expense)}</div>
            <div className="text-xs">{formatINR(income - expense)}</div>
          </div>
        </button>
        {open && weeks.length > 0 && (
          <ul className="divide-y text-sm border-t">
            {weeks.map((w) => (
              <li
                key={w.label}
                className="flex items-center justify-between px-5 py-2 text-xs"
              >
                <span className="text-muted-foreground">{w.label}</span>
                <div className="flex items-center gap-3">
                  <span className="text-sky-500">
                    {formatINR(w.totals.income_paise)}
                  </span>
                  <span className="text-rose-500">
                    {formatINR(w.totals.expense_paise)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
