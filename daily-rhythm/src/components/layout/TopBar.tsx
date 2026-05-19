import { useLocation } from "react-router-dom";
import { Menu, Sun, Moon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";

const TITLES: Record<string, string> = {
  "/": "Home",
  "/dashboard": "Dashboard",
  "/daily-routine": "Daily Routine",
  "/todos": "Todos",
  "/gym": "Gym Workout",
  "/coding-tracker": "Coding Tracker",
  "/health/period": "Period Tracker",
  "/health/diabetes": "Diabetes",
  "/finance/transactions": "Transactions",
  "/finance/stats": "Stats",
  "/finance/accounts": "Accounts",
  "/finance/categories": "Categories",
  "/finance": "Finance",
  "/settings/profile": "Profile",
  "/settings/appearance": "Appearance",
  "/settings/integrations": "Integrations",
};

function titleFor(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  // Longest matching prefix
  const match = Object.keys(TITLES)
    .filter((p) => p !== "/" && pathname.startsWith(p))
    .sort((a, b) => b.length - a.length)[0];
  return match ? TITLES[match] : "DailyWork";
}

export function TopBar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const location = useLocation();
  const { user } = useAuth();
  const { resolved, setTheme } = useTheme();
  const title = titleFor(location.pathname);

  const initials = (user?.email ?? "?")
    .split("@")[0]
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <button
        type="button"
        onClick={onOpenSidebar}
        aria-label="Open navigation"
        className="md:hidden p-2 -ml-2 rounded-md hover:bg-accent transition-colors"
      >
        <Menu className="h-5 w-5" />
      </button>

      <h2 className="text-sm font-medium text-muted-foreground truncate">
        <span className="hidden sm:inline text-foreground">DailyWork</span>
        <span className="hidden sm:inline mx-2 opacity-50">/</span>
        <span className="text-foreground">{title}</span>
      </h2>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
          className="p-2 rounded-md hover:bg-accent transition-colors"
        >
          {resolved === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <div
          className="hidden sm:flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold ring-1 ring-primary/20"
          aria-hidden
          title={user?.email ?? ""}
        >
          {initials}
        </div>
      </div>
    </header>
  );
}
