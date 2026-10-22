// Shared helpers for per-space todo configuration (categories / statuses /
// custom fields). The config lives as JSONB on the `todo_spaces` row; the
// Inbox (space_id null) is virtual and has no row, so it falls back to these
// defaults.

import type { TodoCategory, TodoStatus, TodoCustomField, TodoSpace } from "@/types";

/** Seeded status set — mirrors the DB default in migration
 *  20260803000006_todo_space_config.sql. Used for the Inbox (no row) and as a
 *  fallback for real spaces whose `statuses` column is somehow empty. */
export const DEFAULT_STATUSES: TodoStatus[] = [
  { key: "open", label: "Open", color: "#94a3b8" },
  { key: "in_progress", label: "In progress", color: "#3b82f6" },
  { key: "review", label: "Review", color: "#6366f1" },
  { key: "fixed_in_developer", label: "Fixed in developer", color: "#0ea5e9" },
  { key: "validation", label: "Validation", color: "#14b8a6" },
  { key: "fixed", label: "Fixed", color: "#10b981", done: true },
  { key: "not_an_issue", label: "Not an issue", color: "#6b7280", done: true },
  { key: "later", label: "Later", color: "#8b5cf6" },
  { key: "not_reproduced", label: "Not reproduced", color: "#64748b", done: true },
  { key: "completed", label: "Completed", color: "#22c55e", done: true },
  { key: "closed", label: "Closed", color: "#475569", done: true },
  { key: "on_hold", label: "On hold", color: "#f59e0b" },
];

/** The default status key applied to new todos (matches the DB default). */
export const DEFAULT_STATUS_KEY = "open";

/** Resolved config for a page: real space reads its columns, Inbox uses
 *  sensible defaults (no categories, default statuses, no custom fields). */
export type SpaceConfig = {
  categories: TodoCategory[];
  statuses: TodoStatus[];
  customFields: TodoCustomField[];
};

export const INBOX_CONFIG: SpaceConfig = {
  categories: [],
  statuses: DEFAULT_STATUSES,
  customFields: [],
};

/** Read a real space's config, tolerating null/empty columns. */
export function spaceConfig(space: TodoSpace | null): SpaceConfig {
  if (!space) return INBOX_CONFIG;
  const statuses =
    Array.isArray(space.statuses) && space.statuses.length > 0
      ? space.statuses
      : DEFAULT_STATUSES;
  return {
    categories: Array.isArray(space.categories) ? space.categories : [],
    statuses,
    customFields: Array.isArray(space.custom_fields) ? space.custom_fields : [],
  };
}

/** Slugify a label into a stable key: lowercase, non-alphanumerics → "_",
 *  collapsed and trimmed. Used for category / custom-field keys. */
export function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Terminal keys from the original seed, which shipped without a `done` flag
 *  (see 20260803000006), so they have to be treated as done by key alone. */
const IMPLICIT_DONE_KEYS = new Set(["done", "cancelled", "completed", "closed"]);

/** Whether a status counts as "done" for is_done sync.
 *
 *  An explicit flag always wins — including an explicit `false`. The space
 *  editor writes `done` on every status it saves, so once a status has been
 *  edited its checkbox is authoritative; previously a status that inherited
 *  the key "done" or "cancelled" was forced terminal even with the box
 *  unticked, and the UI gave no way to say otherwise. The key fallback now
 *  applies only when the flag is absent, which is exactly the seeded case. */
export function statusIsDone(statusKey: string | undefined, statuses: TodoStatus[]): boolean {
  if (!statusKey) return false;
  const found = statuses.find((s) => s.key === statusKey);
  if (found && typeof found.done === "boolean") return found.done;
  return IMPLICIT_DONE_KEYS.has(statusKey);
}

/** Is this ticket complete?
 *
 *  The *status* is authoritative, because it is what the card shows — reading
 *  the stored `is_done` column instead let the two drift, so a ticket badged
 *  "In Progress" could sit under DONE and a "Completed" one under ACTIVE.
 *  `is_done` is consulted only when the status key isn't in the space config
 *  (a status deleted or renamed since the ticket was written), where it is the
 *  only signal left. It is still written on every save for the dashboard,
 *  agenda and weekly review, which read it directly. */
export function todoIsDone(
  todo: { status?: string; is_done: boolean },
  statuses: TodoStatus[]
): boolean {
  if (todo.status && statuses.some((s) => s.key === todo.status)) {
    return statusIsDone(todo.status, statuses);
  }
  return todo.is_done;
}

/** Look up a status by key within a config set (falls back to undefined). */
export function findStatus(statusKey: string | undefined, statuses: TodoStatus[]): TodoStatus | undefined {
  if (!statusKey) return undefined;
  return statuses.find((s) => s.key === statusKey);
}

/** Look up a category by key. */
export function findCategory(
  key: string | null | undefined,
  categories: TodoCategory[]
): TodoCategory | undefined {
  if (!key) return undefined;
  return categories.find((c) => c.key === key);
}
