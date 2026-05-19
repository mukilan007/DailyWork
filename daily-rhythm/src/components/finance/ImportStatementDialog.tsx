import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { FileUp, Loader2, AlertCircle, FileCheck2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import {
  ACCOUNT_TYPE_LABEL,
  ACCOUNT_TYPE_ORDER,
  formatINR,
  paiseToRupees,
  rupeesToPaise,
} from "@/lib/finance";
import {
  detectAccountInfo,
  extractPdfText,
  parseStatement,
  type DetectedAccountInfo,
  type ParsedRow,
} from "@/lib/pdf-statement";
import { findDuplicates, suggestCategory } from "@/lib/import-suggest";
import type {
  AccountType,
  FinanceAccount,
  FinanceCategory,
  FinanceTransaction,
} from "@/types";

/** A parsed row plus the per-row editable state shown in the review table. */
interface ReviewRow {
  parsed: ParsedRow;
  selected: boolean;
  duplicate: boolean;
  /** Optional override for amount (paise) — user can fix parser slips. */
  amount_paise: number;
  /** Optional override for kind. */
  kind: "income" | "expense";
  /** Optional category override. `null` = uncategorised. */
  category_id: string | null;
}

interface ImportStatementDialogProps {
  open: boolean;
  onClose: () => void;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  /** Look up existing rows for the chosen account in a date range so we can
   *  flag duplicates accurately — even when the statement covers months that
   *  aren't currently loaded in the parent page. */
  fetchExistingInRange: (
    accountId: string,
    fromDate: string,
    toDate: string
  ) => Promise<FinanceTransaction[]>;
  /** Called after a successful import with the newly-inserted rows so the
   *  parent page can prepend them to its local state. */
  onImported: (rows: FinanceTransaction[]) => void;
  /** Insert function — kept as a prop so the parent owns the supabase client. */
  insertRows: (
    rows: Array<{
      kind: "income" | "expense";
      occurred_on: string;
      account_id: string;
      category_id: string | null;
      amount_paise: number;
      note: string | null;
    }>
  ) => Promise<FinanceTransaction[]>;
  /** Create a new account inline (used when the user has no accounts yet or
   *  imports a statement for a brand-new account detected from the PDF). The
   *  returned row is pushed back to the parent so its account list stays in
   *  sync. */
  createAccount: (input: {
    name: string;
    account_type: AccountType;
  }) => Promise<FinanceAccount>;
}

type Stage = "pick" | "parsing" | "review";

type AccountMode = "existing" | "new";

export function ImportStatementDialog({
  open,
  onClose,
  accounts,
  categories,
  fetchExistingInRange,
  onImported,
  insertRows,
  createAccount,
}: ImportStatementDialogProps) {
  const [stage, setStage] = useState<Stage>("pick");
  const [accountId, setAccountId] = useState<string>("");
  const [accountMode, setAccountMode] = useState<AccountMode>("existing");
  const [newAccountName, setNewAccountName] = useState<string>("");
  const [newAccountType, setNewAccountType] = useState<AccountType>("account");
  const [autoDetected, setAutoDetected] = useState<DetectedAccountInfo | null>(
    null
  );
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<string>("");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [importing, setImporting] = useState(false);

  // Reset whenever the dialog re-opens.
  useEffect(() => {
    if (!open) return;
    setStage("pick");
    // When the user has no accounts yet, force "create new" mode.
    const initialMode: AccountMode = accounts.length === 0 ? "new" : "existing";
    setAccountMode(initialMode);
    setAccountId(accounts[0]?.id ?? "");
    setNewAccountName("");
    setNewAccountType("account");
    setAutoDetected(null);
    setFileName("");
    setError(null);
    setRows([]);
    setProgressMsg("");
  }, [open, accounts]);

  /** True when the pick stage has enough info to accept a file upload.
   *  For "new account" mode we don't require a name up-front because the
   *  parser auto-detects one from the PDF header — the user can confirm or
   *  edit it later. */
  const pickReady =
    accountMode === "existing" ? !!accountId : true;

  const selectedCount = useMemo(() => rows.filter((r) => r.selected).length, [rows]);
  const selectedTotal = useMemo(
    () =>
      rows
        .filter((r) => r.selected)
        .reduce(
          (acc, r) => {
            if (r.kind === "income") acc.income += r.amount_paise;
            else acc.expense += r.amount_paise;
            return acc;
          },
          { income: 0, expense: 0 }
        ),
    [rows]
  );

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Allow re-picking the same file later.
    e.target.value = "";
    if (accountMode === "existing" && !accountId) {
      setError("Pick an account first.");
      return;
    }
    setFileName(file.name);
    setError(null);
    setStage("parsing");
    setProgressMsg("Reading PDF…");
    try {
      const text = await extractPdfText(file);
      if (!text.trim()) {
        setError(
          "This PDF has no extractable text (likely a scanned image). OCR isn't supported."
        );
        setStage("pick");
        return;
      }
      // Auto-detect bank + masked account from the PDF header. If the user
      // hasn't already typed a name for a new account, pre-fill it so they
      // can just confirm.
      const detected = detectAccountInfo(text);
      setAutoDetected(detected);
      if (accountMode === "new") {
        if (!newAccountName.trim() && detected.suggestedName) {
          setNewAccountName(detected.suggestedName);
        }
        if (detected.suggestedType && detected.suggestedType !== "other") {
          setNewAccountType(detected.suggestedType);
        }
      }
      setProgressMsg("Parsing transactions…");
      const parsed = parseStatement(text);
      if (parsed.length === 0) {
        setError(
          "Couldn't recognise any transactions. Your bank's layout may not be supported."
        );
        setStage("pick");
        return;
      }
      // Duplicate detection only makes sense against an existing account. For
      // a brand-new account every row is — by definition — new.
      let dups: Set<number> = new Set();
      if (accountMode === "existing" && accountId) {
        setProgressMsg("Checking for duplicates…");
        const dates = parsed.map((p) => p.occurred_on).sort();
        const fromDate = dates[0];
        const toDate = dates[dates.length - 1];
        const existing = await fetchExistingInRange(
          accountId,
          fromDate,
          toDate
        );
        dups = findDuplicates(parsed, existing, accountId);
      }
      const reviewed: ReviewRow[] = parsed.map((p, i) => {
        const suggestion = suggestCategory(p.description, categories, p.kind);
        return {
          parsed: p,
          selected: !dups.has(i),
          duplicate: dups.has(i),
          amount_paise: p.amount_paise,
          kind: p.kind,
          category_id: suggestion?.category_id ?? null,
        };
      });
      setRows(reviewed);
      setStage("review");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/password/i.test(msg)) {
        setError(
          "PDF is password-protected. Remove the password and re-upload."
        );
      } else {
        setError(`Failed to read PDF: ${msg}`);
      }
      setStage("pick");
    }
  }

  function toggleRow(i: number) {
    setRows((cur) =>
      cur.map((r, idx) => (idx === i ? { ...r, selected: !r.selected } : r))
    );
  }
  function toggleAll() {
    const anyUnselected = rows.some((r) => !r.selected);
    setRows((cur) => cur.map((r) => ({ ...r, selected: anyUnselected })));
  }
  function updateRow(i: number, patch: Partial<ReviewRow>) {
    setRows((cur) => cur.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function handleImport() {
    if (selectedCount === 0) return;
    if (accountMode === "existing" && !accountId) return;
    if (accountMode === "new" && !newAccountName.trim()) {
      setError("Enter a name for the new account.");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      // Create the new account first so we have an id to attach to every row.
      let targetAccountId = accountId;
      if (accountMode === "new") {
        const created = await createAccount({
          name: newAccountName.trim(),
          account_type: newAccountType,
        });
        targetAccountId = created.id;
      }
      const payload = rows
        .filter((r) => r.selected && r.amount_paise > 0)
        .map((r) => ({
          kind: r.kind,
          occurred_on: r.parsed.occurred_on,
          account_id: targetAccountId,
          category_id: r.category_id,
          amount_paise: r.amount_paise,
          note: r.parsed.description || null,
        }));
      // Chunk to stay well under any single-request size cap.
      const inserted: FinanceTransaction[] = [];
      const CHUNK = 200;
      for (let i = 0; i < payload.length; i += CHUNK) {
        const slice = payload.slice(i, i + CHUNK);
        const out = await insertRows(slice);
        inserted.push(...out);
      }
      onImported(inserted);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  const parentCats = useMemo(
    () => categories.filter((c) => !c.parent_id),
    [categories]
  );
  const childrenByParent = useMemo(() => {
    const m = new Map<string, FinanceCategory[]>();
    for (const c of categories) {
      if (!c.parent_id) continue;
      const arr = m.get(c.parent_id) ?? [];
      arr.push(c);
      m.set(c.parent_id, arr);
    }
    return m;
  }, [categories]);

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!importing) onClose();
      }}
      title="Import bank statement"
      description="Upload a PDF and review the parsed transactions before importing."
      className="max-w-4xl"
    >
      {error && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-500/5 p-3 text-sm text-rose-600"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {stage === "pick" && (
        <div className="space-y-4">
          {/* Mode toggle — only shown when the user already has accounts.
              With zero accounts we hard-force "new" mode. */}
          {accounts.length > 0 && (
            <div className="inline-flex rounded-md border bg-muted p-0.5 text-xs">
              {(
                [
                  { value: "existing", label: "Use existing account" },
                  { value: "new", label: "Create new account" },
                ] as Array<{ value: AccountMode; label: string }>
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAccountMode(opt.value)}
                  className={cn(
                    "rounded px-3 py-1.5 transition-colors",
                    accountMode === opt.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {accountMode === "existing" ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">Account</label>
              <Select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="" disabled>
                  Select an account…
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                All imported transactions will be assigned to this account.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {accounts.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  You don't have any accounts yet — we'll create one from the
                  statement you upload.
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-[1fr,160px] gap-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Account name</label>
                  <input
                    type="text"
                    value={newAccountName}
                    onChange={(e) => setNewAccountName(e.target.value)}
                    placeholder="e.g. HDFC Savings ••1234"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Type</label>
                  <Select
                    value={newAccountType}
                    onChange={(e) =>
                      setNewAccountType(e.target.value as AccountType)
                    }
                  >
                    {ACCOUNT_TYPE_ORDER.map((t) => (
                      <option key={t} value={t}>
                        {ACCOUNT_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              {autoDetected?.suggestedName && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-primary" />
                  Auto-detected from PDF:{" "}
                  <span className="font-medium text-foreground">
                    {autoDetected.suggestedName}
                  </span>
                </p>
              )}
            </div>
          )}

          {/* Use a native <label htmlFor> so the browser triggers the file
              input directly — no JS-dispatched click, which avoids both the
              recursive-bubble issue and the "dialog becomes unresponsive
              after cancel" issue we saw with fileRef.current?.click(). */}
          <label
            htmlFor="import-pdf-file"
            aria-disabled={!pickReady}
            className={cn(
              "block rounded-lg border-2 border-dashed p-8 text-center transition-colors",
              pickReady
                ? "border-input hover:border-primary cursor-pointer"
                : "border-input opacity-60 cursor-not-allowed pointer-events-none"
            )}
          >
            <FileUp className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium">
              {fileName || "Click to choose a PDF bank statement"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Works best with text-based PDFs from HDFC, ICICI, SBI, Axis, Kotak, etc.
            </p>
          </label>
          <input
            id="import-pdf-file"
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={handleFile}
            disabled={!pickReady}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {stage === "parsing" && (
        <div className="py-12 flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium">{progressMsg || "Working…"}</p>
          <p className="text-xs text-muted-foreground">{fileName}</p>
        </div>
      )}

      {stage === "review" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <FileCheck2 className="h-4 w-4" />
              <span>
                Parsed <strong className="text-foreground">{rows.length}</strong> rows
                from <span className="font-mono text-xs">{fileName}</span>
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="text-sky-500">+{formatINR(selectedTotal.income)}</span>
              {"  "}
              <span className="text-rose-500">-{formatINR(selectedTotal.expense)}</span>
            </div>
          </div>

          {/* Target-account banner. Especially helpful when a new account will
              be created on import. */}
          <div className="flex items-center gap-2 text-xs">
            <Badge variant={accountMode === "new" ? "warning" : "default"}>
              {accountMode === "new" ? "New account" : "Account"}
            </Badge>
            <span className="text-muted-foreground">
              {accountMode === "new"
                ? `Will create "${newAccountName.trim() || "—"}" (${ACCOUNT_TYPE_LABEL[newAccountType]}) and attach all rows.`
                : `Imports into ${accounts.find((a) => a.id === accountId)?.name ?? "—"}.`}
            </span>
          </div>

          <div className="max-h-[50vh] overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b">
                <tr className="text-left">
                  <th className="px-2 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((r) => r.selected)}
                      onChange={toggleAll}
                      aria-label="Toggle all rows"
                    />
                  </th>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2 w-24">Kind</th>
                  <th className="px-2 py-2 w-44">Category</th>
                  <th className="px-2 py-2 w-28 text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={i}
                    className={cn(
                      "border-b last:border-b-0",
                      !r.selected && "opacity-50",
                      r.duplicate && "bg-amber-500/5"
                    )}
                  >
                    <td className="px-2 py-1.5 align-top">
                      <input
                        type="checkbox"
                        checked={r.selected}
                        onChange={() => toggleRow(i)}
                        aria-label={`Toggle row ${i + 1}`}
                      />
                    </td>
                    <td className="px-2 py-1.5 align-top whitespace-nowrap font-mono text-xs">
                      {r.parsed.occurred_on}
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="line-clamp-2">{r.parsed.description}</span>
                        {r.duplicate && (
                          <Badge variant="warning">duplicate</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <Select
                        value={r.kind}
                        onChange={(e) =>
                          updateRow(i, {
                            kind: e.target.value as "income" | "expense",
                          })
                        }
                        className="h-8 text-xs"
                      >
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <Select
                        value={r.category_id ?? ""}
                        onChange={(e) =>
                          updateRow(i, {
                            category_id: e.target.value || null,
                          })
                        }
                        className="h-8 text-xs"
                      >
                        <option value="">— Uncategorised —</option>
                        {parentCats.map((p) => {
                            const kids = childrenByParent.get(p.id) ?? [];
                            return (
                              <optgroup key={p.id} label={p.name}>
                                <option value={p.id}>{p.name}</option>
                                {kids.map((k) => (
                                  <option key={k.id} value={k.id}>
                                    {"  ↳ "}
                                    {k.name}
                                  </option>
                                ))}
                              </optgroup>
                            );
                          })}
                      </Select>
                    </td>
                    <td className="px-2 py-1.5 align-top text-right">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        value={paiseToRupees(r.amount_paise)}
                        onChange={(e) => {
                          const v = rupeesToPaise(e.target.value);
                          if (v !== null) updateRow(i, { amount_paise: v });
                        }}
                        className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right text-xs"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-xs text-muted-foreground">
              {selectedCount} of {rows.length} selected. Duplicates are
              deselected by default.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onClose} disabled={importing}>
                Cancel
              </Button>
              <Button
                onClick={handleImport}
                disabled={importing || selectedCount === 0}
              >
                {importing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Importing…
                  </>
                ) : (
                  <>Import {selectedCount} rows</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
