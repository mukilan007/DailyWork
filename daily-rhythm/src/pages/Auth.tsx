import { FormEvent, useState } from "react";
import { Activity } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Toast, ToastKind } from "@/components/ui/Toast";
import {
  derivePassword,
  describePasswordIssues,
  PASSWORD_HINT,
  PASSWORD_MIN_LENGTH,
  validatePasswordStrength,
} from "@/lib/passwordHash";

type ToastState = { kind: ToastKind; title?: string; message: string } | null;

/** Map a Supabase auth error message to a friendlier title + (optional) actionable hint. */
function describeAuthError(raw: string): { title: string; message: string } {
  const m = raw.toLowerCase();
  if (m.includes("error sending confirmation email") || m.includes("error sending")) {
    return {
      title: "Couldn't send confirmation email",
      message: `${raw} — Supabase's default mail service likely rejected or rate-limited this address. Configure custom SMTP in the Supabase dashboard, or temporarily disable email confirmation while testing.`,
    };
  }
  if (m.includes("invalid login credentials")) {
    return { title: "Sign-in failed", message: "Email or password is incorrect." };
  }
  if (m.includes("email not confirmed")) {
    return { title: "Email not verified", message: "Open the confirmation link we emailed you, then try again." };
  }
  if (m.includes("user already registered")) {
    return { title: "Account exists", message: "This email is already registered. Try signing in instead." };
  }
  if (m.includes("password should be")) {
    return { title: "Weak password", message: raw };
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return { title: "Too many attempts", message: `${raw} — wait a minute and try again.` };
  }
  return { title: "Something went wrong", message: raw };
}

type Mode = "signin" | "signup";

const COPY: Record<Mode, { title: string; subtitle: string; submit: string; toggleText: string; toggleLink: string; autocomplete: string }> = {
  signin: {
    title: "Welcome back",
    subtitle: "Sign in to continue tracking your day.",
    submit: "Sign in",
    toggleText: "No account?",
    toggleLink: "Create one",
    autocomplete: "current-password",
  },
  signup: {
    title: "Create your account",
    subtitle: "Start tracking habits, health, and workouts.",
    submit: "Sign up",
    toggleText: "Already have an account?",
    toggleLink: "Sign in",
    autocomplete: "new-password",
  },
};

export function AuthPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const [loading, setLoading] = useState(false);

  const c = COPY[mode];

  function showError(rawMessage: string) {
    const { title, message } = describeAuthError(rawMessage);
    setToast({ kind: "error", title, message });
    setEmail("");
    setPassword("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setToast(null);

    // Enforce strong-password policy on signup only. Sign-in must accept
    // whatever the user has on file so legacy short-password accounts can
    // still log in (and migrate via the fallback below).
    if (mode === "signup") {
      const issues = validatePasswordStrength(password);
      if (issues.length > 0) {
        setLoading(false);
        setToast({
          kind: "error",
          title: "Weak password",
          message: describePasswordIssues(issues),
        });
        return;
      }
    }

    const cleanEmail = email.trim();
    const derivedPassword = await derivePassword(cleanEmail, password);

    if (mode === "signin") {
      // Try the derived (new format) password first.
      const first = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: derivedPassword,
      });

      // Legacy fallback: accounts created before client-side hashing was
      // introduced have `bcrypt(plaintext)` in the DB. On invalid-credentials
      // try the raw password once; on success, silently rotate the row to
      // the derived format so the next sign-in is single-shot.
      if (first.error && /invalid login credentials/i.test(first.error.message)) {
        const legacy = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (!legacy.error) {
          // Best-effort migration. If rotation fails (e.g. transient network),
          // the user is still signed in via plaintext and will retry next time.
          await supabase.auth.updateUser({ password: derivedPassword }).catch(() => {});
          setLoading(false);
          return;
        }
      }

      setLoading(false);
      if (first.error) showError(first.error.message);
      return;
    }

    const { data, error: err } = await supabase.auth.signUp({
      email: cleanEmail,
      password: derivedPassword,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });

    setLoading(false);
    if (err) {
      showError(err.message);
      return;
    }
    // Supabase returns a user with empty (or missing) `identities` when the email is already registered.
    if (data.user && !data.user.identities?.length) {
      showError("User already registered");
      return;
    }
    setToast({
      kind: "success",
      title: "Check your inbox",
      message: `We sent a confirmation link to ${cleanEmail}. Open it to verify your account, then sign in.`,
    });
    setEmail("");
    setPassword("");
  }

  function toggle() {
    setMode((m) => (m === "signin" ? "signup" : "signin"));
    setToast(null);
    // Clear credentials so values from the previous mode don't carry over —
    // a sign-in password the user didn't intend to register with, or vice versa.
    setEmail("");
    setPassword("");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary/10 via-background to-background relative overflow-hidden">
      {toast && (
        <Toast
          kind={toast.kind}
          title={toast.title}
          message={toast.message}
          onDismiss={() => setToast(null)}
          duration={toast.kind === "error" ? 8000 : 6000}
        />
      )}

      {/* Decorative blobs */}
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-indigo-500/10 blur-3xl" aria-hidden />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="h-14 w-14 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30 ring-1 ring-primary/40">
            <Activity className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">DailyWork</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Habits, health, and workouts in one place.
          </p>
        </div>

        <Card className="shadow-xl border-border/60">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">{c.title}</CardTitle>
            <CardDescription>{c.subtitle}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  autoComplete={c.autocomplete}
                  placeholder={mode === "signup" ? `At least ${PASSWORD_MIN_LENGTH} characters` : "••••••••"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  // Sign-in keeps a permissive minLength so legacy short-password
                  // accounts can still submit and trigger the migration path.
                  minLength={mode === "signup" ? PASSWORD_MIN_LENGTH : 1}
                  required
                />
                {mode === "signup" && (
                  <p className="text-[11px] text-muted-foreground">{PASSWORD_HINT}</p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Please wait…" : c.submit}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                {c.toggleText}{" "}
                <button
                  type="button"
                  onClick={toggle}
                  className="text-primary font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline"
                >
                  {c.toggleLink}
                </button>
              </p>
            </form>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          By continuing you agree to keep your data in your own Supabase project.
        </p>
      </div>
    </div>
  );
}
