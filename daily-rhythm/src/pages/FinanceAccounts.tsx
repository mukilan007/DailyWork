import { FormEvent, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import type { AccountType, FinanceAccount } from "@/types";
import { ACCOUNT_TYPE_LABEL, ACCOUNT_TYPE_ORDER } from "@/lib/finance";

const ACCOUNT_TYPES: AccountType[] = ["cash", "account", "card", "savings", "other"];

export function FinanceAccountsPage() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FinanceAccount | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FinanceAccount | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error: err } = await supabase
        .from("finance_accounts")
        .select("*")
        .is("archived_at", null)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (err) setError(err.message);
      else setAccounts((data as FinanceAccount[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(a: FinanceAccount) {
    setEditing(a);
    setDialogOpen(true);
  }

  async function handleSave(name: string, type: AccountType) {
    if (!user) return;
    setBusy(true);
    setError(null);
    if (editing) {
      const { data, error: err } = await supabase
        .from("finance_accounts")
        .update({ name, account_type: type })
        .eq("id", editing.id)
        .select()
        .single();
      if (err) setError(err.message);
      else if (data) {
        setAccounts((cur) =>
          cur.map((a) => (a.id === editing.id ? (data as FinanceAccount) : a))
        );
      }
    } else {
      const position = accounts.filter((a) => a.account_type === type).length;
      const { data, error: err } = await supabase
        .from("finance_accounts")
        .insert({ user_id: user.id, name, account_type: type, position })
        .select()
        .single();
      if (err) setError(err.message);
      else if (data) setAccounts((cur) => [...cur, data as FinanceAccount]);
    }
    setBusy(false);
    setDialogOpen(false);
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    const { error: err } = await supabase
      .from("finance_accounts")
      .delete()
      .eq("id", confirmDelete.id);
    setBusy(false);
    if (err) {
      // Likely "foreign key violation" from transactions referencing this account.
      setError(
        /violat/i.test(err.message)
          ? "Can't delete — this account has transactions. Remove them first."
          : err.message
      );
      setConfirmDelete(null);
      return;
    }
    setAccounts((cur) => cur.filter((a) => a.id !== confirmDelete.id));
    setConfirmDelete(null);
  }

  const grouped = ACCOUNT_TYPE_ORDER.map((type) => ({
    type,
    label: ACCOUNT_TYPE_LABEL[type],
    items: accounts.filter((a) => a.account_type === type),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description="Wallets, bank accounts, and cards used for tracking money in and out."
        icon={<Wallet className="h-5 w-5" />}
        actions={
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" /> Add account
          </Button>
        }
      />

      {error && (
        <p className="text-sm text-rose-500" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <SkeletonList rows={3} />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={<Wallet className="h-6 w-6" />}
          title="No accounts yet"
          description="Add a Cash, Bank, Card, or Savings account to start tracking transactions."
          action={
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4" /> Add account
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {grouped.map((g) => (
            <Card key={g.type}>
              <CardContent className="p-0">
                <div className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground border-b">
                  {g.label}
                </div>
                <ul className="divide-y">
                  {g.items.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between px-5 py-3 text-sm"
                    >
                      <span className="font-medium">{a.name}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(a)}
                          aria-label={`Edit ${a.name}`}
                          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(a)}
                          aria-label={`Delete ${a.name}`}
                          className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AccountDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        initial={editing}
        onSave={handleSave}
        busy={busy}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete account?"
        description={
          confirmDelete
            ? `"${confirmDelete.name}" will be permanently removed.`
            : ""
        }
        destructive
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(null)}
        busy={busy}
      />
    </div>
  );
}

interface AccountDialogProps {
  open: boolean;
  onClose: () => void;
  initial: FinanceAccount | null;
  onSave: (name: string, type: AccountType) => void | Promise<void>;
  busy: boolean;
}

function AccountDialog({ open, onClose, initial, onSave, busy }: AccountDialogProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("cash");

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setType(initial?.account_type ?? "cash");
  }, [open, initial]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    void onSave(trimmed, type);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? "Edit account" : "Add account"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="acc-name">Name</Label>
          <Input
            id="acc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. HDFC credit card"
            required
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="acc-type">Type</Label>
          <Select
            id="acc-type"
            value={type}
            onChange={(e) => setType(e.target.value as AccountType)}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {initial ? "Save" : "Add"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
