// Date helpers — keep all date math in one place so timezone bugs are localised.
// All `YYYY-MM-DD` strings are in the user's local timezone (matches Postgres `date`).

export function ymd(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

/** Returns the Monday of the week containing `d`, at local midnight. */
export function startOfWeek(d: Date = new Date()): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const day = out.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(out, diff);
}

/** Returns an array of 7 Date objects, Mon..Sun, for the week containing `d`. */
export function weekDates(d: Date = new Date()): Date[] {
  const start = startOfWeek(d);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

/** Long-form date label like "Tuesday, May 14". */
export function formatLongDate(d: Date = new Date()): string {
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

/** 1-based day-of-year for a local date. Good enough for stable daily picks. */
export function dayOfYear(d: Date = new Date()): number {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / 86_400_000);
}

/** Short relative time: "just now", "5m ago", "2h ago", "3d ago", or a date for older. */
export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return formatDate(iso);
}
