import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in."
  );
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/**
 * True if a PostgREST/Postgres error indicates that `column` doesn't exist on
 * the target table — usually because a pending migration hasn't been applied.
 *
 * Detects both:
 *   - PostgREST `PGRST204` (schema cache miss after column add/remove)
 *   - Postgres `42703` (undefined_column) surfaced through PostgREST
 *
 * Then narrows by name to avoid matching unrelated errors whose message
 * happens to contain the column word.
 */
export function isMissingColumnError(
  err: { code?: string | null; message?: string | null } | null | undefined,
  column: string
): boolean {
  if (!err) return false;
  const codeMatches = err.code === "PGRST204" || err.code === "42703";
  if (!codeMatches) return false;
  const msg = err.message ?? "";
  // Word-boundary match so e.g. column "cat" doesn't match the word "category".
  return new RegExp(`\\b${escapeRegExp(column)}\\b`, "i").test(msg);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
