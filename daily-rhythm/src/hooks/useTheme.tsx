import { createContext, ReactNode, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system" | "panda";

interface ThemeContextValue {
  theme: Theme;
  /** The visual mode actually applied. "panda" is a third mode in addition
   *  to light/dark — it has its own colour tokens and decorative background. */
  resolved: "light" | "dark" | "panda";
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const STORAGE_KEY = "daily-rhythm-theme";

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
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    return saved ?? "system";
  });
  const [resolved, setResolved] = useState<"light" | "dark" | "panda">(() => resolve(theme));

  useEffect(() => {
    const r = resolve(theme);
    setResolved(r);
    applyRootClasses(r);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

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
