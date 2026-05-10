import { FormEvent, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";

export function SettingsProfilePage() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [profileMsg, setProfileMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [pwMsg, setPwMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">Manage your display name and account credentials.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Personal info</CardTitle>
          <CardDescription>How you appear in the app.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={user?.email ?? ""} disabled />
              <p className="text-xs text-muted-foreground">Email changes require re-confirmation and aren't supported here yet.</p>
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

            {profileMsg && (
              <p
                role={profileMsg.kind === "error" ? "alert" : "status"}
                className={profileMsg.kind === "error" ? "text-sm text-destructive" : "text-sm text-emerald-600 dark:text-emerald-400"}
              >
                {profileMsg.text}
              </p>
            )}

            <Button type="submit" disabled={savingProfile || loadingProfile}>
              {savingProfile ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Updates immediately — you'll stay signed in on this device.</CardDescription>
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
            </div>

            {pwMsg && (
              <p
                role={pwMsg.kind === "error" ? "alert" : "status"}
                className={pwMsg.kind === "error" ? "text-sm text-destructive" : "text-sm text-emerald-600 dark:text-emerald-400"}
              >
                {pwMsg.text}
              </p>
            )}

            <Button type="submit" disabled={savingPw}>
              {savingPw ? "Updating…" : "Update password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
