import { FormEvent, useEffect, useState } from "react";
import {
  User,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Trash2,
  Database,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { PageHeader } from "@/components/ui/PageHeader";
import { Dialog } from "@/components/ui/Dialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const DELETE_CONFIRM_PHRASE = "delete my account";

const RETENTION_DEFAULT = 24;
const RETENTION_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "1 month" },
  { value: 3, label: "3 months" },
  { value: 6, label: "6 months" },
  { value: 12, label: "1 year" },
  { value: 24, label: "2 years (max)" },
];

export function SettingsProfilePage() {
  const { user, signOut } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [profileMsg, setProfileMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [pwMsg, setPwMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [retention, setRetention] = useState<number>(RETENTION_DEFAULT);
  const [retentionAvailable, setRetentionAvailable] = useState(true);
  const [savingRetention, setSavingRetention] = useState(false);
  const [retentionMsg, setRetentionMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      // Always load display_name (safe). Try retention_months separately so
      // an un-migrated DB (missing column, PG error 42703) doesn't block the
      // rest of the profile.
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setProfileMsg({ kind: "error", text: error.message });
      } else if (data?.display_name) {
        setDisplayName(data.display_name);
      }

      const { data: retData, error: retError } = await supabase
        .from("profiles")
        .select("retention_months")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (retError) {
        // 42703 = undefined column. Treat as "retention feature not yet
        // migrated" and hide the card silently.
        if (retError.code === "42703" || /retention_months/i.test(retError.message)) {
          setRetentionAvailable(false);
        } else {
          setRetentionMsg({ kind: "error", text: retError.message });
        }
      } else if (retData) {
        setRetention(retData.retention_months ?? RETENTION_DEFAULT);
      }
      setLoadingProfile(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSavingProfile(true);
    setProfileMsg(null);
    const { error } = await supabase
      .from("profiles")
      .upsert(
        { user_id: user.id, display_name: displayName.trim() || null, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    setSavingProfile(false);
    setProfileMsg(error ? { kind: "error", text: error.message } : { kind: "success", text: "Saved." });
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setSavingPw(true);
    setPwMsg(null);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPw(false);
    if (error) {
      setPwMsg({ kind: "error", text: error.message });
    } else {
      setPwMsg({ kind: "success", text: "Password updated." });
      setNewPassword("");
    }
  }

  async function saveRetention(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSavingRetention(true);
    setRetentionMsg(null);
    const { error } = await supabase
      .from("profiles")
      .upsert(
        { user_id: user.id, retention_months: retention, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    setSavingRetention(false);
    setRetentionMsg(
      error
        ? { kind: "error", text: error.message }
        : { kind: "success", text: "Retention updated. Pruning runs nightly." }
    );
  }

  function openDeleteDialog() {
    setDeleteConfirm("");
    setDeleteError(null);
    setDeleteOpen(true);
  }

  async function confirmDelete(e: FormEvent) {
    e.preventDefault();
    if (deleteConfirm.trim().toLowerCase() !== DELETE_CONFIRM_PHRASE) {
      setDeleteError(`Type "${DELETE_CONFIRM_PHRASE}" to confirm.`);
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    const { error } = await supabase.rpc("delete_user_account");
    if (error) {
      setDeleting(false);
      setDeleteError(error.message);
      return;
    }
    // Auth session is now invalid — sign out locally to clear the cached
    // session and route back to /auth.
    await signOut();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        icon={<User className="h-5 w-5" />}
        description="Manage your display name and account credentials."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4 text-primary" /> Personal info
          </CardTitle>
          <CardDescription>How you appear in the app.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={user?.email ?? ""} disabled className="bg-muted/50" />
              <p className="text-xs text-muted-foreground">
                Email changes require re-confirmation and aren&rsquo;t supported here yet.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={loadingProfile ? "Loading…" : "Your name"}
                disabled={loadingProfile}
                maxLength={80}
              />
            </div>

            {profileMsg && <FormMessage msg={profileMsg} />}

            <Button type="submit" disabled={savingProfile || loadingProfile}>
              {savingProfile ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" /> Change password
          </CardTitle>
          <CardDescription>Updates immediately — you&rsquo;ll stay signed in on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="newPassword">New password</Label>
              <PasswordInput
                id="newPassword"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
              />
              <p className="text-xs text-muted-foreground">Minimum 6 characters.</p>
            </div>

            {pwMsg && <FormMessage msg={pwMsg} />}

            <Button type="submit" disabled={savingPw}>
              {savingPw ? "Updating…" : "Update password"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {retentionAvailable && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" /> Data retention
          </CardTitle>
          <CardDescription>
            How long to keep your time-series data. Anything older is pruned
            nightly. Maximum 2 years.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveRetention} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="retention">Keep for</Label>
              <Select
                id="retention"
                value={retention}
                onChange={(e) => setRetention(Number(e.target.value))}
                disabled={loadingProfile || savingRetention}
              >
                {RETENTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="rounded-md border border-input bg-muted/30 p-3 text-xs space-y-1.5">
              <p className="font-medium text-foreground">What gets pruned</p>
              <ul className="list-disc pl-5 text-muted-foreground space-y-0.5">
                <li>Activity completions, workouts, period logs, glucose readings, todos</li>
              </ul>
              <p className="font-medium text-foreground mt-2">What is kept</p>
              <ul className="list-disc pl-5 text-muted-foreground space-y-0.5">
                <li>Your profile, habit list, and connected integrations</li>
              </ul>
            </div>

            {retentionMsg && <FormMessage msg={retentionMsg} />}

            <Button type="submit" disabled={savingRetention || loadingProfile}>
              {savingRetention ? "Saving…" : "Save retention"}
            </Button>
          </form>
        </CardContent>
      </Card>
      )}

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" /> Danger zone
          </CardTitle>
          <CardDescription>
            Permanently delete your account and all data — routines, workouts, todos,
            health logs, integrations. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="destructive"
            onClick={openDeleteDialog}
          >
            <Trash2 className="h-4 w-4" /> Delete account
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={deleteOpen}
        onClose={() => (deleting ? undefined : setDeleteOpen(false))}
        title="Delete account?"
        description="This wipes every row that belongs to you and signs you out. There is no undo."
      >
        <form onSubmit={confirmDelete} className="space-y-4">
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <p className="font-medium">You will lose:</p>
            <ul className="mt-1 list-disc pl-5 space-y-0.5 text-xs">
              <li>Profile and settings</li>
              <li>Daily routine activities and completions</li>
              <li>Workouts and exercises</li>
              <li>Todos</li>
              <li>Period logs and glucose readings</li>
              <li>Connected integrations</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="deleteConfirm">
              Type <span className="font-mono text-destructive">{DELETE_CONFIRM_PHRASE}</span> to confirm
            </Label>
            <Input
              id="deleteConfirm"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              autoComplete="off"
              autoFocus
              disabled={deleting}
              aria-invalid={!!deleteError}
            />
          </div>

          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={
                deleting ||
                deleteConfirm.trim().toLowerCase() !== DELETE_CONFIRM_PHRASE
              }
            >
              {deleting ? "Deleting…" : "Delete forever"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function FormMessage({ msg }: { msg: { kind: "success" | "error"; text: string } }) {
  const Icon = msg.kind === "error" ? AlertCircle : CheckCircle2;
  return (
    <p
      role={msg.kind === "error" ? "alert" : "status"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm",
        msg.kind === "error"
          ? "bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20"
          : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-1 ring-inset ring-emerald-500/20"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {msg.text}
    </p>
  );
}
