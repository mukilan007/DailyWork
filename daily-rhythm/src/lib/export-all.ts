// Full-account data export. Fetches every user-owned table from Supabase in
// parallel and downloads a single self-describing JSON backup, plus a helper
// for one-off per-table CSV downloads. Reuses the blob/download plumbing from
// src/lib/export.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadFile, toCSV, toJSON, todayStamp } from "@/lib/export";

/**
 * Every table that carries a `user_id` column. `workout_exercises` is the one
 * exception (keyed by `workout_id`) and is fetched separately below.
 */
export const EXPORT_TABLES = [
  "profiles",
  "activities",
  "activity_completions",
  "workouts",
  "workout_exercises",
  "period_logs",
  "glucose_readings",
  "todos",
  "todo_recurrences",
  "finance_accounts",
  "finance_categories",
  "finance_transactions",
  "finance_recurrences",
  "finance_budgets",
  "coding_problems",
  "learn_phases",
  "mood_logs",
  "study_sessions",
  "job_applications",
  "mock_interviews",
  "vault_notes",
  "focus_sessions",
  "planner_blocks",
  "user_settings",
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number];

type Row = Record<string, unknown>;

export interface ExportAllResult {
  /** Rows exported per table. */
  counts: Record<string, number>;
  /** Total rows across all tables. */
  total: number;
  /** Tables that failed to fetch (exported as empty arrays), with the error. */
  errors: Record<string, string>;
}

/** Fetch every row of one user-owned table. Throws on query error. */
export async function fetchUserTable(
  supabase: SupabaseClient,
  table: ExportTable,
  userId: string
): Promise<Row[]> {
  if (table === "workout_exercises") {
    return fetchWorkoutExercises(supabase, userId);
  }
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

/**
 * `workout_exercises` has no user_id — resolve the user's workout ids first,
 * then pull exercises in chunks so the `.in()` filter never gets too large.
 */
async function fetchWorkoutExercises(
  supabase: SupabaseClient,
  userId: string
): Promise<Row[]> {
  const { data: workouts, error: wErr } = await supabase
    .from("workouts")
    .select("id")
    .eq("user_id", userId);
  if (wErr) throw new Error(wErr.message);
  const ids = (workouts ?? []).map((w: { id: string }) => w.id);
  if (ids.length === 0) return [];

  const CHUNK = 200;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await supabase
        .from("workout_exercises")
        .select("*")
        .in("workout_id", chunk);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    })
  );
  return results.flat();
}

/**
 * Fetch ALL user tables in parallel and download one JSON backup file named
 * `dailywork-backup-YYYY-MM-DD.json`, shaped `{ exported_at, tables: {...} }`.
 *
 * A table that fails to fetch (e.g. not yet migrated) is exported as an empty
 * array and reported in `errors` rather than aborting the whole backup — this
 * is a live app and a partial backup beats none. Throws only if every table
 * fails (almost certainly an auth/network problem).
 */
export async function exportAllData(
  supabase: SupabaseClient,
  userId: string
): Promise<ExportAllResult> {
  const settled = await Promise.all(
    EXPORT_TABLES.map(async (table) => {
      try {
        const rows = await fetchUserTable(supabase, table, userId);
        return { table, rows, error: null as string | null };
      } catch (e) {
        return { table, rows: [] as Row[], error: e instanceof Error ? e.message : String(e) };
      }
    })
  );

  const tables: Record<string, Row[]> = {};
  const counts: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const { table, rows, error } of settled) {
    tables[table] = rows;
    counts[table] = rows.length;
    if (error) errors[table] = error;
  }

  if (Object.keys(errors).length === EXPORT_TABLES.length) {
    throw new Error(`Export failed for every table. First error: ${Object.values(errors)[0]}`);
  }

  const payload = { exported_at: new Date().toISOString(), tables };
  downloadFile(
    `dailywork-backup-${todayStamp()}.json`,
    toJSON(payload),
    "application/json"
  );

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, total, errors };
}

/** Download in-memory rows of one table as `<name>-YYYY-MM-DD.csv`. */
export function exportTableCsv(name: string, rows: Row[]): void {
  downloadFile(`${name}-${todayStamp()}.csv`, toCSV(rows), "text/csv;charset=utf-8");
}
