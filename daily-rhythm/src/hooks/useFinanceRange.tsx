import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Outlet } from "react-router-dom";
import { ymd } from "@/lib/dates";
import { startOfMonth, endOfMonth } from "@/lib/finance";

/**
 * Shared date-range filter for the whole Finance section. Both the
 * Transactions and Stats pages read/write the same window, so switching
 * between them (or reloading) keeps the selected month / range instead of
 * resetting to the current month each time. Persisted to localStorage.
 */

export type FinanceFilterMode = "month" | "range";

interface FinanceRangeState {
  filterMode: FinanceFilterMode;
  year: number;
  /** 0-based month index (0 = Jan). */
  month: number;
  rangeFrom: string; // YYYY-MM-DD
  rangeTo: string; // YYYY-MM-DD
}

interface FinanceRangeValue extends FinanceRangeState {
  setFilterMode: (m: FinanceFilterMode) => void;
  setYear: (y: number) => void;
  setMonth: (m: number) => void;
  setRangeFrom: (d: string) => void;
  setRangeTo: (d: string) => void;
  /** Effective query window (range mode is order-corrected). */
  fromDate: string;
  toDate: string;
}

const STORAGE_KEY = "daily-rhythm-finance-range";

function defaultState(): FinanceRangeState {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  return {
    filterMode: "month",
    year: y,
    month: m,
    rangeFrom: ymd(startOfMonth(y, m)),
    rangeTo: ymd(endOfMonth(y, m)),
  };
}

function loadState(): FinanceRangeState {
  if (typeof window === "undefined") return defaultState();
  const base = defaultState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<FinanceRangeState>;
    return {
      filterMode: p.filterMode === "range" ? "range" : "month",
      year: typeof p.year === "number" ? p.year : base.year,
      month:
        typeof p.month === "number" && p.month >= 0 && p.month <= 11
          ? p.month
          : base.month,
      rangeFrom: typeof p.rangeFrom === "string" ? p.rangeFrom : base.rangeFrom,
      rangeTo: typeof p.rangeTo === "string" ? p.rangeTo : base.rangeTo,
    };
  } catch {
    return base;
  }
}

const FinanceRangeContext = createContext<FinanceRangeValue | null>(null);

export function FinanceRangeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FinanceRangeState>(loadState);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore quota / disabled storage */
    }
  }, [state]);

  const value = useMemo<FinanceRangeValue>(() => {
    const { filterMode, year, month, rangeFrom, rangeTo } = state;
    const ordered =
      rangeFrom <= rangeTo
        ? { from: rangeFrom, to: rangeTo }
        : { from: rangeTo, to: rangeFrom };
    return {
      ...state,
      setFilterMode: (m) => setState((s) => ({ ...s, filterMode: m })),
      setYear: (y) => setState((s) => ({ ...s, year: y })),
      setMonth: (m) => setState((s) => ({ ...s, month: m })),
      setRangeFrom: (d) => setState((s) => ({ ...s, rangeFrom: d })),
      setRangeTo: (d) => setState((s) => ({ ...s, rangeTo: d })),
      fromDate:
        filterMode === "range" ? ordered.from : ymd(startOfMonth(year, month)),
      toDate:
        filterMode === "range" ? ordered.to : ymd(endOfMonth(year, month)),
    };
  }, [state]);

  return (
    <FinanceRangeContext.Provider value={value}>
      {children}
    </FinanceRangeContext.Provider>
  );
}

export function useFinanceRange(): FinanceRangeValue {
  const ctx = useContext(FinanceRangeContext);
  if (!ctx) {
    throw new Error("useFinanceRange must be used within a FinanceRangeProvider");
  }
  return ctx;
}

/** Layout route wrapper — provides the shared range to all nested finance pages. */
export function FinanceRangeLayout() {
  return (
    <FinanceRangeProvider>
      <Outlet />
    </FinanceRangeProvider>
  );
}
