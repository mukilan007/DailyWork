// Global Cmd+K / Ctrl+K command palette: navigate to any page, or search
// across todos, transactions, coding problems, vault notes, and job
// applications. Self-contained — mount <CommandPalette /> once anywhere in
// the authed tree, and drop <CommandPaletteTrigger /> in the top bar.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CornerDownLeft, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

// The trigger button and the palette are decoupled via a window event, so the
// integrator can mount them in different parts of the layout with no wiring.
const OPEN_EVENT = "daily-rhythm:command-palette-open";

// ---------------------------------------------------------------------------
// Static navigation entries
// ---------------------------------------------------------------------------

interface NavEntry {
  label: string;
  to: string;
}

const NAV_ENTRIES: NavEntry[] = [
  { label: "Dashboard", to: "/dashboard" },
  { label: "Today", to: "/today" },
  { label: "Todos", to: "/todos" },
  { label: "Daily Routine", to: "/daily-routine" },
  { label: "Gym", to: "/gym" },
  { label: "Coding Tracker", to: "/coding-tracker" },
  { label: "Focus", to: "/focus" },
  { label: "Weekly Review", to: "/weekly-review" },
  { label: "Prep Roadmap", to: "/prep/roadmap" },
  { label: "Applications", to: "/prep/applications" },
  { label: "Mock Interviews", to: "/prep/interviews" },
  { label: "Study Log", to: "/prep/study" },
  { label: "Vault", to: "/prep/vault" },
  { label: "Finance", to: "/finance/transactions" },
  { label: "Finance Stats", to: "/finance/stats" },
  { label: "Settings", to: "/settings/profile" },
];

/** Fuzzy-ish match: every query char appears in order in the candidate. */
function fuzzyMatch(query: string, candidate: string): boolean {
  const q = query.toLowerCase().replace(/\s+/g, "");
  const c = candidate.toLowerCase();
  if (c.includes(query.toLowerCase())) return true;
  let i = 0;
  for (const ch of c) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return i === q.length;
}

// ---------------------------------------------------------------------------
// Data search
// ---------------------------------------------------------------------------

type ResultType = "todo" | "transaction" | "problem" | "note" | "application";

interface DataResult {
  key: string;
  type: ResultType;
  title: string;
  to: string;
}

const TYPE_BADGES: Record<ResultType, { label: string; className: string }> = {
  todo: { label: "Todo", className: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  transaction: { label: "Txn", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  problem: { label: "Problem", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  note: { label: "Vault", className: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  application: { label: "Job", className: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
};

/** Escape LIKE wildcards and strip chars that would break a PostgREST .or(). */
function ilikePattern(q: string): string {
  return `%${q.replace(/[%_]/g, "\\$&").replace(/[,()]/g, " ")}%`;
}

const SEARCH_LIMIT = 5;

async function searchData(query: string, userId: string): Promise<DataResult[]> {
  const pattern = ilikePattern(query);

  // Every query is independent and tolerant of errors (e.g. a table that is
  // empty or not yet migrated) — a failed source just contributes no results.
  const safe = async (p: PromiseLike<DataResult[]>): Promise<DataResult[]> => {
    try {
      return await p;
    } catch {
      return [];
    }
  };

  const [todos, txns, problems, notes, apps] = await Promise.all([
    safe(
      supabase
        .from("todos")
        .select("id,title")
        .eq("user_id", userId)
        .ilike("title", pattern)
        .limit(SEARCH_LIMIT)
        .then(({ data, error }) => {
          if (error) throw error;
          return (data ?? []).map((r) => ({
            key: `todo-${r.id}`,
            type: "todo" as const,
            title: r.title,
            to: "/todos",
          }));
        })
    ),
    safe(
      supabase
        .from("finance_transactions")
        .select("id,note")
        .eq("user_id", userId)
        .ilike("note", pattern)
        .limit(SEARCH_LIMIT)
        .then(({ data, error }) => {
          if (error) throw error;
          return (data ?? []).map((r) => ({
            key: `txn-${r.id}`,
            type: "transaction" as const,
            title: r.note ?? "(no note)",
            to: "/finance/transactions",
          }));
        })
    ),
    safe(
      supabase
        .from("coding_problems")
        .select("id,title")
        .eq("user_id", userId)
        .ilike("title", pattern)
        .limit(SEARCH_LIMIT)
        .then(({ data, error }) => {
          if (error) throw error;
          return (data ?? []).map((r) => ({
            key: `prob-${r.id}`,
            type: "problem" as const,
            title: r.title,
            to: "/coding-tracker",
          }));
        })
    ),
    safe(
      supabase
        .from("vault_notes")
        .select("id,title")
        .eq("user_id", userId)
        .ilike("title", pattern)
        .limit(SEARCH_LIMIT)
        .then(({ data, error }) => {
          if (error) throw error;
          return (data ?? []).map((r) => ({
            key: `note-${r.id}`,
            type: "note" as const,
            title: r.title,
            to: "/prep/vault",
          }));
        })
    ),
    safe(
      supabase
        .from("job_applications")
        .select("id,company,role")
        .eq("user_id", userId)
        .or(`company.ilike.${pattern},role.ilike.${pattern}`)
        .limit(SEARCH_LIMIT)
        .then(({ data, error }) => {
          if (error) throw error;
          return (data ?? []).map((r) => ({
            key: `app-${r.id}`,
            type: "application" as const,
            title: `${r.company} — ${r.role}`,
            to: "/prep/applications",
          }));
        })
    ),
  ]);

  return [...todos, ...txns, ...problems, ...notes, ...apps];
}

// ---------------------------------------------------------------------------
// Hook: open state + global hotkey
// ---------------------------------------------------------------------------

/**
 * Owns the palette's open state, the global Cmd+K / Ctrl+K hotkey, Escape to
 * close, and the trigger-button open event. Listener lives on window and is
 * cleaned up on unmount.
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function onOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_EVENT, onOpenEvent);
    };
  }, []);

  return { open, setOpen };
}

// ---------------------------------------------------------------------------
// Trigger button (for the top bar)
// ---------------------------------------------------------------------------

export function CommandPaletteTrigger({ className }: { className?: string }) {
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      aria-label="Open command palette"
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-input bg-background px-2.5 h-9 text-sm text-muted-foreground",
        "hover:bg-accent hover:text-accent-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      <Search className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Search…</span>
      <kbd className="hidden sm:inline rounded border border-input bg-muted px-1.5 py-0.5 text-[10px] font-mono">
        {isMac ? "⌘K" : "Ctrl K"}
      </kbd>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

interface FlatItem {
  key: string;
  group: "nav" | "data";
  label: string;
  badge?: ResultType;
  to: string;
}

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  if (!open) return null;
  return <PalettePanel onClose={() => setOpen(false)} />;
}

function PalettePanel({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [dataResults, setDataResults] = useState<DataResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced data search — 250ms, min 2 chars, stale responses dropped.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || !user) {
      setDataResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = ++requestIdRef.current;
    const timer = window.setTimeout(async () => {
      const results = await searchData(q, user.id);
      if (requestIdRef.current !== id) return; // stale
      setDataResults(results);
      setSearching(false);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, user]);

  const navResults = useMemo(() => {
    const q = query.trim();
    if (!q) return NAV_ENTRIES;
    return NAV_ENTRIES.filter((e) => fuzzyMatch(q, e.label));
  }, [query]);

  const items: FlatItem[] = useMemo(
    () => [
      ...navResults.map((e) => ({
        key: `nav-${e.to}`,
        group: "nav" as const,
        label: e.label,
        to: e.to,
      })),
      ...dataResults.map((r) => ({
        key: r.key,
        group: "data" as const,
        label: r.title,
        badge: r.type,
        to: r.to,
      })),
    ],
    [navResults, dataResults]
  );

  // Keep selection in range as results change.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, items.length - 1)));
  }, [items.length]);

  const run = useCallback(
    (item: FlatItem) => {
      onClose();
      navigate(item.to);
    },
    [navigate, onClose]
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (items.length === 0 ? 0 : (s + 1) % items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => (items.length === 0 ? 0 : (s - 1 + items.length) % items.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[selected];
      if (item) run(item);
    }
  }

  const firstDataIndex = items.findIndex((i) => i.group === "data");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm p-4 pt-[12vh]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-lg rounded-xl border bg-card text-card-foreground shadow-lg overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3">
          {searching ? (
            <Loader2 className="h-4 w-4 shrink-0 text-muted-foreground animate-spin" />
          ) : (
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Go to a page or search your data…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
          />
          <kbd className="rounded border border-input bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            esc
          </kbd>
        </div>

        <div id="command-palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {items.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {searching ? "Searching…" : "No matches."}
            </p>
          )}

          {items.map((item, i) => (
            <div key={item.key}>
              {i === 0 && item.group === "nav" && <GroupLabel>Navigation</GroupLabel>}
              {i === firstDataIndex && <GroupLabel>Results</GroupLabel>}
              <button
                type="button"
                role="option"
                aria-selected={i === selected}
                onMouseEnter={() => setSelected(i)}
                onClick={() => run(item)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm",
                  i === selected
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-accent/50"
                )}
              >
                {item.badge && (
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                      TYPE_BADGES[item.badge].className
                    )}
                  >
                    {TYPE_BADGES[item.badge].label}
                  </span>
                )}
                <span className="truncate">{item.label}</span>
                {i === selected && (
                  <CornerDownLeft className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}
