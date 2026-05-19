import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { cn } from "@/lib/utils";
import { ymd } from "@/lib/dates";
import {
  ACCOUNT_TYPE_LABEL,
  ACCOUNT_TYPE_ORDER,
  rupeesToPaise,
  paiseToRupees,
} from "@/lib/finance";
import type {
  AccountType,
  CategoryKind,
  FinanceAccount,
  FinanceCategory,
  FinanceTransaction,
  Frequency,
  TxKind,
} from "@/types";

export type TxDraft = {
  kind: TxKind;
  occurred_on: string;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  amount_paise: number;
  fees_paise: number;
  note: string;
  recurrence: null | {
    frequency: Frequency;
    interval_n: number;
    end_on: string | null;
  };
};

interface TransactionDialogProps {
  open: boolean;
  onClose: () => void;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  /** When set, dialog edits this transaction instead of creating a new one. */
  initial?: FinanceTransaction | null;
  onSave: (draft: TxDraft) => void | Promise<void>;
  busy?: boolean;
  /** Optional: when provided, the user can create a new account inline from
   *  any account-select via a `+` button. The parent owns the supabase call
   *  and is responsible for pushing the new row into its `accounts` list. */
  createAccount?: (input: {
    name: string;
    account_type: AccountType;
  }) => Promise<FinanceAccount>;
  /** Optional: when provided, the user can create a new top-level category
   *  or sub-category inline from the category selects. */
  createCategory?: (input: {
    name: string;
    kind: CategoryKind;
    parent_id: string | null;
  }) => Promise<FinanceCategory>;
}

/** Where the user clicked "+ New account". */
type NewAcctTarget = "account" | "from" | "to";

const FREQUENCIES: Frequency[] = ["daily", "weekly", "monthly", "yearly"];

/** Max length for the free-text Note on a transaction. */
const NOTE_MAX = 50;

export function TransactionDialog({
  open,
  onClose,
  accounts,
  categories,
  initial,
  onSave,
  busy = false,
  createAccount,
  createCategory,
}: TransactionDialogProps) {
  const [kind, setKind] = useState<TxKind>("expense");
  const [date, setDate] = useState(ymd());
  const [accountId, setAccountId] = useState<string>("");
  const [toAccountId, setToAccountId] = useState<string>("");
  const [parentCatId, setParentCatId] = useState<string>("");
  const [subCatId, setSubCatId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [fees, setFees] = useState("");
  const [note, setNote] = useState("");
  const [showRecurrence, setShowRecurrence] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [intervalN, setIntervalN] = useState("1");
  const [endOn, setEndOn] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  // Inline-create state for accounts / categories.
  const [showNewAcct, setShowNewAcct] = useState<NewAcctTarget | null>(null);
  const [newAcctName, setNewAcctName] = useState("");
  const [newAcctType, setNewAcctType] = useState<AccountType>("account");
  const [showNewParentCat, setShowNewParentCat] = useState(false);
  const [showNewSubCat, setShowNewSubCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Hydrate form when dialog opens.
  useEffect(() => {
    if (!open) return;
    setValidationError(null);
    setCreateError(null);
    setShowNewAcct(null);
    setShowNewParentCat(false);
    setShowNewSubCat(false);
    setNewAcctName("");
    setNewAcctType("account");
    setNewCatName("");
    if (initial) {
      setKind(initial.kind);
      setDate(initial.occurred_on);
      setAccountId(initial.account_id);
      setToAccountId(initial.to_account_id ?? "");
      const cat = initial.category_id
        ? categories.find((c) => c.id === initial.category_id)
        : undefined;
      if (cat?.parent_id) {
        setParentCatId(cat.parent_id);
        setSubCatId(cat.id);
      } else {
        setParentCatId(cat?.id ?? "");
        setSubCatId("");
      }
      setAmount(String(paiseToRupees(initial.amount_paise)));
      setFees(initial.fees_paise > 0 ? String(paiseToRupees(initial.fees_paise)) : "");
      setNote(initial.note ?? "");
      setShowRecurrence(false);
    } else {
      setKind("expense");
      setDate(ymd());
      setAccountId(accounts[0]?.id ?? "");
      setToAccountId("");
      setParentCatId("");
      setSubCatId("");
      setAmount("");
      setFees("");
      setNote("");
      setShowRecurrence(false);
      setFrequency("monthly");
      setIntervalN("1");
      setEndOn("");
    }
    // Intentionally depend only on `open` and `initial` — re-running this
    // when `accounts`/`categories` mutate would clobber the user's in-progress
    // draft every time they create a new account / category inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  // When `kind` flips, reset incompatible category state.
  useEffect(() => {
    if (kind === "transfer") {
      setParentCatId("");
      setSubCatId("");
    }
  }, [kind]);

  const accentClass =
    kind === "income"
      ? "text-sky-500"
      : kind === "expense"
      ? "text-rose-500"
      : "text-foreground";

  // Categories are shared across income and expense — we no longer filter by
  // `c.kind` here. The dialog still hides the category fields entirely for
  // transfers (see the `kind === "transfer"` branch in the JSX).
  const catParents = useMemo(
    () =>
      categories
        .filter((c) => !c.parent_id && !c.archived_at)
        .sort((a, b) => a.position - b.position),
    [categories]
  );
  const catChildren = useMemo(
    () =>
      parentCatId
        ? categories
            .filter((c) => c.parent_id === parentCatId && !c.archived_at)
            .sort((a, b) => a.position - b.position)
        : [],
    [categories, parentCatId]
  );

  async function handleCreateAccount(target: NewAcctTarget) {
    if (!createAccount) return;
    const name = newAcctName.trim();
    if (!name) {
      setCreateError("Enter an account name.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const acct = await createAccount({ name, account_type: newAcctType });
      // Auto-select the newly created account in whichever field opened the
      // inline form.
      if (target === "to") setToAccountId(acct.id);
      else setAccountId(acct.id);
      setNewAcctName("");
      setNewAcctType("account");
      setShowNewAcct(null);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateCategory(level: "parent" | "sub") {
    if (!createCategory) return;
    const name = newCatName.trim();
    if (!name) {
      setCreateError("Enter a category name.");
      return;
    }
    if (level === "sub" && !parentCatId) {
      setCreateError("Pick a parent category first.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const cat = await createCategory({
        name,
        // Categories are shared across income/expense — the DB CHECK still
        // requires a value, so we send "expense" as a sentinel.
        kind: "expense",
        parent_id: level === "sub" ? parentCatId : null,
      });
      if (level === "parent") {
        setParentCatId(cat.id);
        setSubCatId("");
        setShowNewParentCat(false);
      } else {
        setSubCatId(cat.id);
        setShowNewSubCat(false);
      }
      setNewCatName("");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  function cancelInlineCreate() {
    setShowNewAcct(null);
    setShowNewParentCat(false);
    setShowNewSubCat(false);
    setNewAcctName("");
    setNewAcctType("account");
    setNewCatName("");
    setCreateError(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const amt = rupeesToPaise(amount);
    if (amt === null || amt <= 0) {
      setValidationError("Enter a valid positive amount.");
      return;
    }
    if (!accountId) {
      setValidationError(kind === "transfer" ? "Choose a From account." : "Choose an account.");
      return;
    }
    if (kind === "transfer") {
      if (!toAccountId) {
        setValidationError("Choose a To account.");
        return;
      }
      if (toAccountId === accountId) {
        setValidationError("From and To must differ.");
        return;
      }
    }
    if (note.trim().length > NOTE_MAX) {
      setValidationError(`Note must be ${NOTE_MAX} characters or fewer.`);
      return;
    }
    const feesPaise = fees ? rupeesToPaise(fees) ?? 0 : 0;
    const draft: TxDraft = {
      kind,
      occurred_on: date,
      account_id: accountId,
      to_account_id: kind === "transfer" ? toAccountId : null,
      category_id:
        kind === "transfer"
          ? null
          : subCatId || parentCatId || null,
      amount_paise: amt,
      fees_paise: feesPaise,
      note: note.trim(),
      recurrence: showRecurrence
        ? {
            frequency,
            interval_n: Math.max(1, Number(intervalN) || 1),
            end_on: endOn || null,
          }
        : null,
    };
    setValidationError(null);
    void onSave(draft);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? "Edit transaction" : kindTitle(kind)}
      className="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Kind tabs */}
        <div className="grid grid-cols-3 gap-2">
          {(["income", "expense", "transfer"] as TxKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "rounded-md border px-3 py-2 text-sm font-medium capitalize transition-colors",
                kind === k
                  ? k === "income"
                    ? "border-sky-500 text-sky-500"
                    : k === "expense"
                    ? "border-rose-500 text-rose-500"
                    : "border-foreground text-foreground"
                  : "border-input text-muted-foreground hover:text-foreground"
              )}
            >
              {k}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[80px,1fr] gap-x-3 gap-y-3 items-center">
          <Label htmlFor="tx-date">Date</Label>
          <Input
            id="tx-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />

          {kind === "transfer" ? (
            <>
              <Label htmlFor="tx-from">From</Label>
              <div className="space-y-2 min-w-0">
                <div className="flex gap-1.5">
                  <Select
                    id="tx-from"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    required
                    className="flex-1"
                  >
                    <option value="" disabled>
                      Select account
                    </option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                  {createAccount && (
                    <PlusButton
                      label="Create new account"
                      onClick={() =>
                        setShowNewAcct(showNewAcct === "from" ? null : "from")
                      }
                      active={showNewAcct === "from"}
                    />
                  )}
                </div>
                {showNewAcct === "from" && (
                  <NewAccountInline
                    name={newAcctName}
                    setName={setNewAcctName}
                    type={newAcctType}
                    setType={setNewAcctType}
                    onSave={() => handleCreateAccount("from")}
                    onCancel={cancelInlineCreate}
                    busy={creating}
                    error={createError}
                  />
                )}
              </div>

              <Label htmlFor="tx-to">To</Label>
              <div className="space-y-2 min-w-0">
                <div className="flex gap-1.5">
                  <Select
                    id="tx-to"
                    value={toAccountId}
                    onChange={(e) => setToAccountId(e.target.value)}
                    required
                    className="flex-1"
                  >
                    <option value="" disabled>
                      Select account
                    </option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                  {createAccount && (
                    <PlusButton
                      label="Create new account"
                      onClick={() =>
                        setShowNewAcct(showNewAcct === "to" ? null : "to")
                      }
                      active={showNewAcct === "to"}
                    />
                  )}
                </div>
                {showNewAcct === "to" && (
                  <NewAccountInline
                    name={newAcctName}
                    setName={setNewAcctName}
                    type={newAcctType}
                    setType={setNewAcctType}
                    onSave={() => handleCreateAccount("to")}
                    onCancel={cancelInlineCreate}
                    busy={creating}
                    error={createError}
                  />
                )}
              </div>
            </>
          ) : (
            <>
              <Label htmlFor="tx-account">Account</Label>
              <div className="space-y-2 min-w-0">
                <div className="flex gap-1.5">
                  <Select
                    id="tx-account"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    required
                    className="flex-1"
                  >
                    <option value="" disabled>
                      Select account
                    </option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                  {createAccount && (
                    <PlusButton
                      label="Create new account"
                      onClick={() =>
                        setShowNewAcct(
                          showNewAcct === "account" ? null : "account"
                        )
                      }
                      active={showNewAcct === "account"}
                    />
                  )}
                </div>
                {showNewAcct === "account" && (
                  <NewAccountInline
                    name={newAcctName}
                    setName={setNewAcctName}
                    type={newAcctType}
                    setType={setNewAcctType}
                    onSave={() => handleCreateAccount("account")}
                    onCancel={cancelInlineCreate}
                    busy={creating}
                    error={createError}
                  />
                )}
              </div>

              <Label htmlFor="tx-cat">Category</Label>
              <div className="space-y-2 min-w-0">
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex gap-1.5">
                    <Select
                      id="tx-cat"
                      value={parentCatId}
                      onChange={(e) => {
                        setParentCatId(e.target.value);
                        setSubCatId("");
                      }}
                      className="flex-1"
                    >
                      <option value="">(None)</option>
                      {catParents.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                    {createCategory && (
                      <PlusButton
                        label="Create new category"
                        onClick={() => {
                          setShowNewParentCat((s) => !s);
                          setShowNewSubCat(false);
                          setCreateError(null);
                          setNewCatName("");
                        }}
                        active={showNewParentCat}
                      />
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <Select
                      value={subCatId}
                      onChange={(e) => setSubCatId(e.target.value)}
                      disabled={!parentCatId}
                      className="flex-1"
                    >
                      <option value="">(No subcategory)</option>
                      {catChildren.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                    {createCategory && (
                      <PlusButton
                        label={
                          parentCatId
                            ? "Create new subcategory"
                            : "Pick a parent category first"
                        }
                        onClick={() => {
                          setShowNewSubCat((s) => !s);
                          setShowNewParentCat(false);
                          setCreateError(null);
                          setNewCatName("");
                        }}
                        active={showNewSubCat}
                        disabled={!parentCatId}
                      />
                    )}
                  </div>
                </div>
                {(showNewParentCat || showNewSubCat) && (
                  <NewCategoryInline
                    name={newCatName}
                    setName={setNewCatName}
                    kindLabel={
                      kind === "income" ? "income" : "expense"
                    }
                    isSub={showNewSubCat}
                    parentName={
                      showNewSubCat
                        ? catParents.find((c) => c.id === parentCatId)?.name ??
                          null
                        : null
                    }
                    onSave={() =>
                      handleCreateCategory(showNewSubCat ? "sub" : "parent")
                    }
                    onCancel={cancelInlineCreate}
                    busy={creating}
                    error={createError}
                  />
                )}
              </div>
            </>
          )}

          <Label htmlFor="tx-amount">Amount</Label>
          <div className="flex items-center gap-2">
            <Input
              id="tx-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className={cn("font-semibold", accentClass)}
              required
            />
            {kind === "transfer" && (
              <Input
                aria-label="Transfer fee"
                inputMode="decimal"
                value={fees}
                onChange={(e) => setFees(e.target.value)}
                placeholder="Fees"
                className="w-28"
              />
            )}
          </div>

          <Label htmlFor="tx-note">Note</Label>
          <div className="space-y-1">
            <Textarea
              id="tx-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
              rows={2}
              maxLength={NOTE_MAX}
              placeholder="Optional"
              aria-describedby="tx-note-count"
            />
            <div
              id="tx-note-count"
              className={cn(
                "text-xs text-right",
                note.length >= NOTE_MAX
                  ? "text-rose-500"
                  : "text-muted-foreground"
              )}
            >
              {note.length}/{NOTE_MAX}
            </div>
          </div>
        </div>

        {/* Recurrence toggle */}
        {!initial && (
          <div className="rounded-md border p-3 space-y-3">
            <button
              type="button"
              onClick={() => setShowRecurrence((s) => !s)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <Repeat className="h-4 w-4" />
              {showRecurrence ? "Remove recurrence" : "Repeat / Installment"}
            </button>
            {showRecurrence && (
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="space-y-1">
                  <Label htmlFor="freq">Frequency</Label>
                  <Select
                    id="freq"
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as Frequency)}
                  >
                    {FREQUENCIES.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="interval">Every</Label>
                  <Input
                    id="interval"
                    type="number"
                    min={1}
                    max={365}
                    value={intervalN}
                    onChange={(e) => setIntervalN(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="end">End on</Label>
                  <Input
                    id="end"
                    type="date"
                    value={endOn}
                    onChange={(e) => setEndOn(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {validationError && (
          <p className="text-sm text-rose-500" role="alert">
            {validationError}
          </p>
        )}

        <div className="flex justify-between items-center pt-1">
          {kind === "transfer" && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <ArrowLeftRight className="h-3 w-3" />
              Transfers don't affect totals.
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {initial ? "Save" : "Add"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function kindTitle(k: TxKind): string {
  if (k === "income") return "Add income";
  if (k === "expense") return "Add expense";
  return "Add transfer";
}

// ---------------------------------------------------------------------------
// Inline-create helpers
// ---------------------------------------------------------------------------

function PlusButton({
  label,
  onClick,
  active,
  disabled,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex items-center justify-center rounded-md border border-input bg-background px-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:hover:bg-background",
        active && "border-primary text-primary"
      )}
    >
      <Plus className="h-4 w-4" />
    </button>
  );
}

function NewAccountInline({
  name,
  setName,
  type,
  setType,
  onSave,
  onCancel,
  busy,
  error,
}: {
  name: string;
  setName: (v: string) => void;
  type: AccountType;
  setType: (v: AccountType) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <div className="rounded-md border border-dashed bg-muted/30 p-3 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr,140px] gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Account name"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSave();
            }
          }}
        />
        <Select
          value={type}
          onChange={(e) => setType(e.target.value as AccountType)}
        >
          {ACCOUNT_TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {ACCOUNT_TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
      </div>
      {error && (
        <p className="text-xs text-rose-500" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onSave}
          disabled={busy || !name.trim()}
        >
          {busy ? "Creating…" : "Create account"}
        </Button>
      </div>
    </div>
  );
}

function NewCategoryInline({
  name,
  setName,
  kindLabel,
  isSub,
  parentName,
  onSave,
  onCancel,
  busy,
  error,
}: {
  name: string;
  setName: (v: string) => void;
  kindLabel: "income" | "expense";
  isSub: boolean;
  parentName: string | null;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <div className="rounded-md border border-dashed bg-muted/30 p-3 space-y-2">
      <p className="text-xs text-muted-foreground">
        {isSub
          ? `New subcategory under ${parentName ? `"${parentName}"` : "selected parent"}`
          : `New top-level ${kindLabel} category`}
      </p>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={isSub ? "Subcategory name" : "Category name"}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSave();
          }
        }}
      />
      {error && (
        <p className="text-xs text-rose-500" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onSave}
          disabled={busy || !name.trim()}
        >
          {busy ? "Creating…" : isSub ? "Create subcategory" : "Create category"}
        </Button>
      </div>
    </div>
  );
}
