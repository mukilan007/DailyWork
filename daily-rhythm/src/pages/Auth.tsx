import { FormEvent, useState } from "react";
import { Activity, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";

type Mode = "signin" | "signup";

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden focusable="false">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2C41 35.3 44 30 44 24c0-1.2-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const c = COPY[mode];

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const { error: err } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password });

    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (mode === "signup") {
      setSuccess("Check your email to confirm your account, then sign in.");
    }
  }

  async function onGoogle() {
    setGoogleLoading(true);
    setError(null);
    setSuccess(null);

    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });

    if (err) {
      setGoogleLoading(false);
      setError(err.message);
    }
    // On success the browser redirects to Google, so no need to clear loading.
  }

  function toggle() {
    setMode((m) => (m === "signin" ? "signup" : "signin"));
    setError(null);
    setSuccess(null);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary/10 via-background to-background relative overflow-hidden">
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
            <Button
              type="button"
              variant="outline"
              className="w-full mb-4"
              onClick={onGoogle}
              disabled={googleLoading || loading}
            >
              <GoogleIcon className="h-4 w-4 mr-2" />
              {googleLoading ? "Redirecting…" : "Continue with Google"}
            </Button>

            <div className="relative my-4" aria-hidden>
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
                <span className="bg-card px-2 text-muted-foreground">or with email</span>
              </div>
            </div>

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
                  placeholder={mode === "signup" ? "At least 6 characters" : "••••••••"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              {success && (
                <div
                  role="status"
                  className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300"
                >
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{success}</span>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading || googleLoading}>
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
