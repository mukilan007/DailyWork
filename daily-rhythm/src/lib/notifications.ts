// Service-worker registration + lightweight daily-agenda notifications.
// No push server involved — a plain `Notification` fired at most once per
// calendar day when the dashboard loads and something is due.

import { supabase } from "@/lib/supabase";
import { ymd } from "@/lib/dates";

/** localStorage key holding the YYYY-MM-DD of the last agenda notification. */
const LAST_NOTIFY_KEY = "daily-rhythm-last-notify";

/**
 * Register /sw.js. Production-only so dev never fights a stale worker, and
 * guarded for browsers without service worker support. Safe to call from
 * main.tsx unconditionally.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;
  // Wait for load so registration never competes with first-paint work.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

/**
 * Ask for notification permission (no-op if already decided). Returns the
 * resulting permission; "denied" when the Notification API is unavailable.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export interface AgendaSummary {
  /** Overdue todos. */
  overdue: number;
  /** Habits/routine activities not yet completed today. */
  habitsLeft: number;
  /** Coding problems due for revision. */
  revisions: number;
}

/**
 * Fire ONE browser notification per calendar day summarising what's due,
 * e.g. "3 overdue · 2 habits left · 1 problem to revise". Silently does
 * nothing when permission isn't granted, nothing is due, or today's
 * notification already fired (guarded via localStorage).
 */
export function notifyAgenda(summary: AgendaSummary): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const { overdue, habitsLeft, revisions } = summary;
  if (overdue + habitsLeft + revisions <= 0) return;

  const today = ymd();
  try {
    if (localStorage.getItem(LAST_NOTIFY_KEY) === today) return;
  } catch {
    // localStorage unavailable (private mode) — better to skip than to spam.
    return;
  }

  const parts: string[] = [];
  if (overdue > 0) parts.push(`${overdue} overdue`);
  if (habitsLeft > 0) parts.push(`${habitsLeft} habit${habitsLeft === 1 ? "" : "s"} left`);
  if (revisions > 0) parts.push(`${revisions} problem${revisions === 1 ? "" : "s"} to revise`);
  const body = parts.join(" · ");

  try {
    new Notification("DailyWork agenda", { body, icon: "/icon.svg", tag: "dailywork-agenda" });
  } catch {
    // Some platforms (notably Android Chrome) forbid the bare Notification
    // constructor — fall back to the service worker registration if present.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready
        .then((reg) =>
          reg.showNotification("DailyWork agenda", {
            body,
            icon: "/icon.svg",
            tag: "dailywork-agenda",
          })
        )
        .catch(() => undefined);
    }
  }

  try {
    localStorage.setItem(LAST_NOTIFY_KEY, today);
  } catch {
    // Ignore — worst case the guard doesn't persist.
  }
}

/**
 * User-facing "turn on reminders" action: requests permission, then persists
 * `user_settings.notify_enabled = true` so other devices/loads know.
 */
export async function enableNotifications(
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const permission = await requestNotificationPermission();
  if (permission !== "granted") {
    return { ok: false, error: "Notification permission was not granted." };
  }
  const { error } = await supabase
    .from("user_settings")
    .upsert(
      { user_id: userId, notify_enabled: true, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  return error ? { ok: false, error: error.message } : { ok: true };
}
