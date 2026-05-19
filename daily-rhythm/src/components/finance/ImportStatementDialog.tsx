import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  FileUp,
  Loader2,
  AlertCircle,
  FileCheck2,
  Sparkles,
  ChevronDown,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
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
  ACCEPTED_STATEMENT_FORMATS,
  detectAccountInfo,
  detectStatementFormat,
  diagnoseStatement,
  extractStatementText,
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

/** Max chars allowed when editing a row's description in the review table.
 *  Generous because parser-generated descriptions for bank lines can be
 *  long; the underlying `note` column isn't length-constrained on import. */
const DESCRIPTION_MAX = 200;

/** A parsed row plus the per-row editable state shown in the review table. */
interface ReviewRow {
  parsed: ParsedRow;
  selected: boolean;
  duplicate: boolean;
  /** Editable description (defaults to `parsed.description`). Stored as
   *  the transaction's `note` on import so users can clean up OCR noise. */
  description: string;
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
  /** Remembers which format was parsed so the review-screen mapping legend
   *  can describe the right extraction strategy (e.g. "OCR line text" vs
   *  "PDF text run"). */
  const [parsedFormat, setParsedFormat] = useState<
    "pdf" | "csv" | "txt" | "image" | null
  >(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  /** When parsing produces 0 rows we keep the raw extracted text around so
   *  the user can click "Show extracted text" and see what the parser had to
   *  work with — directly answering "why didn't this work?". */
  const [extractedPreview, setExtractedPreview] = useState<string | null>(null);

  // Reset whenever the dialog *transitions* from closed → open. Critically
  // we do NOT depend on `accounts` here: the parent re-creates that array
  // on every render, which would otherwise refire this effect mid-session
  // and blow away the user's in-progress input (account name, picked file,
  // parsed rows, etc.) — looking to the user like the dialog is constantly
  // refreshing / losing data.
  useEffect(() => {
    if (!open) return;
    setStage("pick");
    // Snapshot accounts at open time — using current values inside the
    // effect is safe; we just don't want changes to retrigger it.
    setAccountMode(accounts.length === 0 ? "new" : "existing");
    setAccountId(accounts[0]?.id ?? "");
    setNewAccountName("");
    setNewAccountType("account");
    setAutoDetected(null);
    setFileName("");
    setError(null);
    setRows([]);
    setProgressMsg("");
    setParsedFormat(null);
    setMappingOpen(false);
    setExtractedPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Clipboard paste: while the dialog is on the pick stage, intercept Ctrl+V
  // and pull the first image off the clipboard so the user can paste a
  // Win+Shift+S screenshot straight into OCR. Native file pasting (right-
  // click > Paste in Explorer) shows up as `kind: "file"`; screen snips show
  // up as `type: "image/png"` blobs.
  useEffect(() => {
    if (!open || stage !== "pick") return;
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (!blob) continue;
          e.preventDefault();
          // Synthesise a filename so the user sees something meaningful and
          // detectStatementFormat() can still infer "image" from the MIME.
          const ext = item.type.split("/")[1] || "png";
          const named = new File(
            [blob],
            `clipboard-${Date.now()}.${ext}`,
            { type: item.type }
          );
          void processFile(named);
          return;
        }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // processFile is intentionally not in deps — it closes over the current
    // accountMode/accountId/etc. which we want at paste time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stage, accountMode, accountId]);

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
    // Allow re-picking the same file later.
    e.target.value = "";
    if (file) await processFile(file);
  }

  /** Re-run the parser against a user-edited copy of the OCR/PDF output. Lets
   *  users hand-correct stubborn OCR mistakes (e.g. a dropped decimal point)
   *  without re-uploading the file. Skips duplicate detection — by the time
   *  someone is editing extracted text, hand-curating dupes is more accurate
   *  than range-fetching them. */
  function reparseEditedText(text: string) {
    const parsed = parseStatement(text);
    if (parsed.length === 0) {
      setError(buildParseFailureMessage(text, parsedFormat ?? "unknown"));
      return;
    }
    const reviewed: ReviewRow[] = parsed.map((p) => {
      const suggestion = suggestCategory(p.description, categories, p.kind);
      return {
        parsed: p,
        selected: true,
        duplicate: false,
        description: p.description,
        amount_paise: p.amount_paise,
        kind: p.kind,
        category_id: suggestion?.category_id ?? null,
      };
    });
    setRows(reviewed);
    setError(null);
    setExtractedPreview(null);
    setStage("review");
  }

  async function processFile(file: File) {
    if (accountMode === "existing" && !accountId) {
      setError("Pick an account first.");
      return;
    }
    setFileName(file.name);
    setError(null);
    setStage("parsing");
    const fmt = detectStatementFormat(file);
    setProgressMsg(
      fmt === "pdf"
        ? "Reading PDF…"
        : fmt === "image"
        ? "Running OCR on image…"
        : "Reading file…"
    );
    try {
      const text = await extractStatementText(file, (info) => {
        if (info.stage === "ocr") {
          setProgressMsg(`Running OCR on image… ${Math.round(info.progress * 100)}%`);
        }
      });
      if (!text.trim()) {
        setError(
          fmt === "pdf"
            ? "This PDF has no extractable text (likely a scanned image). Try uploading a screenshot instead."
            : fmt === "image"
            ? "OCR couldn't read any text from this image. Try a sharper screenshot or upload the bank's PDF/CSV instead."
            : "This file appears to be empty."
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
        setError(buildParseFailureMessage(text, fmt));
        // Keep the extracted text around so the user can pop open
        // "Show extracted text" and see exactly what the parser had to work
        // with. Truncate generously — full statements can be huge.
        setExtractedPreview(text.slice(0, 8000));
        setStage("pick");
        return;
      }
      setExtractedPreview(null);
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
          description: p.description,
          amount_paise: p.amount_paise,
          kind: p.kind,
          category_id: suggestion?.category_id ?? null,
        };
      });
      setRows(reviewed);
      setParsedFormat(fmt === "unknown" ? null : fmt);
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
          note: r.description.trim() || null,
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

  // Categories are scoped by kind — each row's dropdown only shows the
  // parents matching the row's own kind.
  const parentsByKind = useMemo(() => {
    const income: FinanceCategory[] = [];
    const expense: FinanceCategory[] = [];
    for (const c of categories) {
      if (c.parent_id || c.archived_at) continue;
      if (c.kind === "income") income.push(c);
      else if (c.kind === "expense") expense.push(c);
    }
    return { income, expense };
  }, [categories]);
  const childrenByParent = useMemo(() => {
    const m = new Map<string, FinanceCategory[]>();
    for (const c of categories) {
      if (!c.parent_id || c.archived_at) continue;
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
          className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/5 p-3 text-sm text-rose-600"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="whitespace-pre-line">{error}</span>
          </div>
          {extractedPreview !== null && (
            <details className="mt-2 ml-6 text-xs text-rose-600/90" open>
              <summary className="cursor-pointer hover:underline">
                Edit extracted text ({extractedPreview.length.toLocaleString()} chars)
                — fix OCR errors below, then re-parse
              </summary>
              <textarea
                value={extractedPreview}
                onChange={(e) => setExtractedPreview(e.target.value)}
                spellCheck={false}
                className="mt-2 w-full max-h-60 min-h-[120px] resize-y overflow-auto rounded border border-rose-500/30 bg-background p-2 font-mono text-[11px] leading-snug text-foreground whitespace-pre-wrap"
              />
              <div className="mt-2 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => reparseEditedText(extractedPreview)}
                  disabled={!extractedPreview.trim()}
                >
                  Re-parse this text
                </Button>
              </div>
            </details>
          )}
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
              {fileName || "Click to choose a bank statement"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Accepts PDF, CSV, TXT, or image (PNG / JPG / WebP). Or paste a
              screenshot with <kbd className="rounded border bg-muted px-1 text-[10px]">Ctrl</kbd>+<kbd className="rounded border bg-muted px-1 text-[10px]">V</kbd>.
              Images use OCR — slower and may need a few row fixes in the
              review step.
            </p>
          </label>
          <input
            id="import-pdf-file"
            type="file"
            accept={ACCEPTED_STATEMENT_FORMATS}
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

          {/* Field-mapping legend. Collapsed by default — a one-click reveal
              showing exactly where each application field was sourced from
              in the uploaded statement. Keeps the review screen uncluttered
              while answering the "what got mapped to what?" question. */}
          <FieldMappingPanel
            open={mappingOpen}
            onToggle={() => setMappingOpen((v) => !v)}
            format={parsedFormat}
            accountLabel={
              accountMode === "new"
                ? `${newAccountName.trim() || "—"} (new)`
                : accounts.find((a) => a.id === accountId)?.name ?? "—"
            }
          />

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
                  <th className="px-2 py-2 w-[120px]">Kind</th>
                  <th className="px-2 py-2 w-[200px]">Category</th>
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
                      <div className="space-y-1 min-w-[200px]">
                        <Input
                          value={r.description}
                          onChange={(e) =>
                            updateRow(i, { description: e.target.value })
                          }
                          maxLength={DESCRIPTION_MAX}
                          aria-label={`Description for row ${i + 1}`}
                          className="h-8 text-xs"
                        />
                        {r.duplicate && (
                          <Badge variant="warning">duplicate</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <Select
                        value={r.kind}
                        onChange={(e) => {
                          const newKind = e.target.value as
                            | "income"
                            | "expense";
                          // Categories are kind-scoped; drop the selection
                          // if it belongs to the opposite kind.
                          updateRow(i, {
                            kind: newKind,
                            category_id:
                              r.kind === newKind ? r.category_id : null,
                          });
                        }}
                        className="h-8 text-xs min-w-[110px]"
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
                        className="h-8 text-xs min-w-[170px]"
                      >
                        <option value="">— Uncategorised —</option>
                        {parentsByKind[r.kind].map((p) => {
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
                      {parentsByKind[r.kind].length === 0 && (
                        <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
                          No {r.kind} categories yet — create one on the
                          Categories page.
                        </p>
                      )}
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

/** Turn the parser's diagnostics into a specific, actionable error message
 *  instead of the unhelpful "your bank's layout may not be supported". The
 *  three failure shapes we explain:
 *   1. Nothing useful in the text at all (likely OCR junk or wrong file).
 *   2. Plenty of lines but none start with a recognised date format.
 *   3. Plenty of dates but no `xx.xx` amounts.
 *   4. Both dates + amounts present but no line had them together — usually
 *      a multi-column layout the heuristic missed. */
function buildParseFailureMessage(
  rawText: string,
  fmt: "pdf" | "csv" | "txt" | "image" | "unknown"
): string {
  const d = diagnoseStatement(rawText);
  const fmtLabel =
    fmt === "image" ? "OCR" :
    fmt === "pdf" ? "PDF" :
    fmt === "csv" ? "CSV" :
    fmt === "txt" ? "text file" :
    "file";

  if (d.totalLines === 0) {
    return `The ${fmtLabel} produced no text at all. ` +
      (fmt === "image"
        ? "Try a sharper, higher-contrast screenshot."
        : "The file appears to be empty.");
  }
  if (d.dateLedLines === 0 && d.amountLines === 0) {
    const sample = d.sampleNoDate[0];
    return (
      `Couldn't find dates or amounts in the ${d.totalLines} lines extracted from this ${fmtLabel}.\n` +
      (fmt === "image"
        ? "OCR quality may be too low — try a sharper screenshot, or upload the bank's PDF/CSV instead."
        : "This doesn't look like a bank statement, or the layout isn't text-based.") +
      (sample ? `\nFirst line we saw: "${truncate(sample, 80)}"` : "")
    );
  }
  if (d.dateLedLines === 0) {
    return (
      `Found ${d.amountLines} line(s) with amounts but none start with a recognised date.\n` +
      "Supported date formats: DD/MM/YYYY, DD-MM-YYYY, DD MMM YYYY, YYYY-MM-DD." +
      (d.sampleNoDate[0]
        ? `\nFirst non-date line: "${truncate(d.sampleNoDate[0], 80)}"`
        : "")
    );
  }
  if (d.amountLines === 0) {
    return (
      `Found ${d.dateLedLines} date row(s) but no \`123.45\`-style amount values.\n` +
      "Amounts must include a two-digit decimal (₹ symbol optional)." +
      (d.sampleDateLed[0]
        ? `\nFirst date row: "${truncate(d.sampleDateLed[0], 80)}"`
        : "")
    );
  }
  return (
    `Found ${d.dateLedLines} date row(s) and ${d.amountLines} amount line(s), but couldn't pair them as transactions on the same line.\n` +
    "This usually means a multi-column layout where dates and amounts are on separate lines." +
    (d.sampleDateLed[0]
      ? `\nSample row: "${truncate(d.sampleDateLed[0], 80)}"`
      : "")
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Per-format description of how each application field was derived. Strings
 *  are kept short and concrete — the goal is to dispel "where did this row
 *  come from?" confusion at a glance. */
const MAPPING_RULES: Record<
  "pdf" | "csv" | "txt" | "image",
  Array<{ field: string; source: string; example?: string }>
> = {
  pdf: [
    { field: "Date", source: "First date token on each line", example: "18/03/2026" },
    { field: "Description", source: "Text between the date and the amount", example: "AMAZON PURCHASE" },
    { field: "Amount", source: "Last currency amount on the line (or balance-column-aware)", example: "₹ 305.00" },
    { field: "Kind", source: "'+' / 'Cr' → income;   '-' / 'Dr' → expense; balance delta otherwise" },
  ],
  csv: [
    { field: "Date", source: "First date-like cell per row", example: "18/03/2026" },
    { field: "Description", source: "Cells between the date and the amount" },
    { field: "Amount", source: "Last numeric cell with a decimal" },
    { field: "Kind", source: "'+' / 'Cr' → income;   '-' / 'Dr' → expense" },
  ],
  txt: [
    { field: "Date", source: "First date token per line" },
    { field: "Description", source: "Text between the date and the amount" },
    { field: "Amount", source: "Last numeric token with a decimal" },
    { field: "Kind", source: "'+' / 'Cr' → income;   '-' / 'Dr' → expense" },
  ],
  image: [
    { field: "Date", source: "First date token per OCR'd line (sharper images = better)" },
    { field: "Description", source: "OCR text between the date and the amount" },
    { field: "Amount", source: "Last currency amount on the OCR'd line — OCR may misread ₹ as a digit; sanity-check before importing", example: "₹ 305.00" },
    { field: "Kind", source: "'+' (income) / unsigned (expense) — OCR may need manual fixes" },
  ],
};

function FieldMappingPanel({
  open,
  onToggle,
  format,
  accountLabel,
}: {
  open: boolean;
  onToggle: () => void;
  format: "pdf" | "csv" | "txt" | "image" | null;
  accountLabel: string;
}) {
  const rules = format ? MAPPING_RULES[format] : MAPPING_RULES.pdf;
  const formatLabel = format
    ? { pdf: "PDF", csv: "CSV", txt: "TXT", image: "Image (OCR)" }[format]
    : "Statement";
  return (
    <div className="rounded-md border bg-muted/30">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-accent/40 transition-colors"
      >
        <span className="flex items-center gap-2">
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              open && "rotate-180"
            )}
          />
          <span className="font-medium text-foreground">Field mapping</span>
          <span className="text-muted-foreground">
            — how {formatLabel} content fills each application field
          </span>
        </span>
      </button>
      {open && (
        <div className="border-t px-3 py-2">
          <ul className="divide-y text-xs">
            <li className="grid grid-cols-[110px,1fr] gap-3 py-1.5 items-baseline">
              <span className="font-medium text-foreground">Account</span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5">
                  picked above
                </span>
                <ArrowRight className="h-3 w-3 shrink-0" />
                <span className="truncate text-foreground">{accountLabel}</span>
              </span>
            </li>
            {rules.map((r) => (
              <li
                key={r.field}
                className="grid grid-cols-[110px,1fr] gap-3 py-1.5 items-baseline"
              >
                <span className="font-medium text-foreground">{r.field}</span>
                <span className="flex flex-wrap items-baseline gap-1.5 text-muted-foreground">
                  <span>{r.source}</span>
                  {r.example && (
                    <span className="font-mono text-[11px] text-foreground/80">
                      e.g. {r.example}
                    </span>
                  )}
                </span>
              </li>
            ))}
            <li className="grid grid-cols-[110px,1fr] gap-3 py-1.5 items-baseline">
              <span className="font-medium text-foreground">Category</span>
              <span className="text-muted-foreground">
                Suggested from description keywords. Editable per row below.
              </span>
            </li>
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Wrong mapping on a row? Edit the kind, category, or amount directly
            in the table below — nothing is saved until you press{" "}
            <span className="font-medium text-foreground">Import</span>.
          </p>
        </div>
      )}
    </div>
  );
}
