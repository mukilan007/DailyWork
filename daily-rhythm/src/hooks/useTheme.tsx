import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type Theme = "light" | "dark" | "system" | "panda";

interface ThemeContextValue {
  theme: Theme;
  /** The visual mode actually applied. "panda" is a third mode in addition
   *  to light/dark — it has its own colour tokens and decorative background. */
  resolved: "light" | "dark" | "panda";
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/** Legacy single-tenant key. Kept only to migrate old installs. */
const LEGACY_KEY = "daily-rhythm-theme";
const KEY_PREFIX = "daily-rhythm-theme:";
const ANON_KEY = `${KEY_PREFIX}anon`;
const DEFAULT_THEME: Theme = "system";

function storageKey(userId: string | null): string {
  return userId ? `${KEY_PREFIX}${userId}` : ANON_KEY;
}

function isTheme(v: string | null): v is Theme {
  return v === "light" || v === "dark" || v === "system" || v === "panda";
}

/** Load the theme for a user, falling back to the legacy global key (one-time
 *  migration) and finally to the system default. */
function loadTheme(userId: string | null): Theme {
  const direct = localStorage.getItem(storageKey(userId));
  if (isTheme(direct)) return direct;

  // One-time migration: if this user has no preference yet, inherit whatever
  // was saved under the old shared key, then write it to the user's slot.
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (isTheme(legacy)) {
    localStorage.setItem(storageKey(userId), legacy);
    return legacy;
  }
  return DEFAULT_THEME;
}

function resolve(theme: Theme): "light" | "dark" | "panda" {
  if (theme === "panda") return "panda";
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

/** Sync the html root's theme classes. The two classes are mutually
 *  exclusive — only one of `dark` / `panda` is ever applied. */
function applyRootClasses(mode: "light" | "dark" | "panda") {
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.classList.toggle("panda", mode === "panda");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Resolve user synchronously from the persisted Supabase session if available,
  // so the first render already lands on the correct theme (no flicker).
  const [userId, setUserId] = useState<string | null>(() => {
    try {
      const raw = localStorage.getItem(
        `sb-${new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split(".")[0]}-auth-token`
      );
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.user?.id ?? parsed?.currentSession?.user?.id ?? null;
    } catch {
      return null;
    }
  });

  const [theme, setThemeState] = useState<Theme>(() => loadTheme(userId));
  const [resolved, setResolved] = useState<"light" | "dark" | "panda">(() => resolve(theme));

  // Apply DOM classes + persist when theme changes.
  useEffect(() => {
    const r = resolve(theme);
    setResolved(r);
    applyRootClasses(r);
    localStorage.setItem(storageKey(userId), theme);
  }, [theme, userId]);

  // React to OS-level changes when set to "system". Panda mode ignores OS
  // preference because the user has explicitly opted into it.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const r = mq.matches ? "dark" : "light";
      setResolved(r);
      applyRootClasses(r);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  // Track auth state — on sign-in/out, swap to that user's stored theme.
  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const id = data.session?.user.id ?? null;
      setUserId((prev) => {
        if (prev === id) return prev;
        setThemeState(loadTheme(id));
        return id;
      });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id ?? null;
      setUserId((prev) => {
        if (prev === id) return prev;
        setThemeState(loadTheme(id));
        return id;
      });
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme: setThemeState }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
