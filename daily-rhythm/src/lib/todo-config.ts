// Shared helpers for per-space todo configuration (categories / statuses /
// custom fields). The config lives as JSONB on the `todo_spaces` row; the
// Inbox (space_id null) is virtual and has no row, so it falls back to these
// defaults.

import type { TodoCategory, TodoStatus, TodoCustomField, TodoSpace } from "@/types";

/** Seeded status set — mirrors the DB default in migration
 *  20260803000006_todo_space_config.sql. Used for the Inbox (no row) and as a
 *  fallback for real spaces whose `statuses` column is somehow empty. */
export const DEFAULT_STATUSES: TodoStatus[] = [
  { key: "todo", label: "Todo", color: "#94a3b8" },
  { key: "in_progress", label: "In progress", color: "#3b82f6" },
  { key: "done", label: "Done", color: "#22c55e", done: true },
  { key: "blocked", label: "Blocked", color: "#ef4444" },
  { key: "cancelled", label: "Cancelled", color: "#64748b", done: true },
];

/** The default status key applied to new todos (matches the DB default). */
export const DEFAULT_STATUS_KEY = "todo";

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

/** Whether a status counts as "done" for is_done sync. A status is done if its
 *  config flags `done:true`, or its key is one of the terminal defaults. */
export function statusIsDone(statusKey: string | undefined, statuses: TodoStatus[]): boolean {
  if (!statusKey) return false;
  const found = statuses.find((s) => s.key === statusKey);
  if (found?.done) return true;
  return statusKey === "done" || statusKey === "cancelled";
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
