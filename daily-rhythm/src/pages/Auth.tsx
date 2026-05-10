import { FormEvent, useState } from "react";
import { Activity } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";

type Mode = "signin" | "signup";

const COPY: Record<Mode, { title: string; submit: string; toggleText: string; toggleLink: string; autocomplete: string }> = {
  signin: {
    title: "Welcome back",
    submit: "Sign in",
    toggleText: "No account?",
    toggleLink: "Create one",
    autocomplete: "current-password",
  },
  signup: {
    title: "Create your account",
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

  function toggle() {
    setMode((m) => (m === "signin" ? "signup" : "signin"));
    setError(null);
    setSuccess(null);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
            <Activity className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle>{c.title}</CardTitle>
          <CardDescription>DailyWork — track your habits, health, and workouts.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {success && (
              <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
                {success}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Please wait…" : c.submit}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              {c.toggleText}{" "}
              <button
                type="button"
                onClick={toggle}
                className="text-primary font-medium hover:underline"
              >
                {c.toggleLink}
              </button>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
