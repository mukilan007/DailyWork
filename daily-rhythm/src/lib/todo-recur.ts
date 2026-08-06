// Recurring todos — mirrors the finance recurrence engine (src/lib/finance.ts).
// The date-stepping math (month-end clamping via anchorDay, local-midnight
// YMD parsing) is shared by importing finance's `nextDueDate` rather than
// duplicating it.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Frequency, Todo, TodoRecurrence, TodoRecurrenceTemplate } from "@/types";
import { nextDueDate } from "@/lib/finance";
import { parseYmd, ymd } from "@/lib/dates";

/** Default local time-of-day a materialised todo is due at. */
export const DEFAULT_DUE_TIME = "09:00";

/** Occurrence date (YYYY-MM-DD) + "HH:MM" local time → ISO datetime. */
export function occurrenceDueAtIso(
  occurrenceYmd: string,
  dueTime: string = DEFAULT_DUE_TIME,
): string {
  const d = parseYmd(occurrenceYmd);
  const [h, m] = dueTime.split(":").map(Number);
  d.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0);
  return d.toISOString();
}

// ----------------------------------------------------------------------------
// Recurrence CRUD
// ----------------------------------------------------------------------------

export type TodoRecurrenceInput = {
  template_json: TodoRecurrenceTemplate;
  frequency: Frequency;
  interval_n: number;
  start_on: string; // YYYY-MM-DD
  end_on: string | null;
  /** Set to the first occurrence's date when the caller inserts that todo
   *  itself, so materialisation doesn't regenerate it. */
  last_materialised_on: string | null;
  /** Owning space; null = Inbox. Materialised todos inherit this. */
  space_id?: string | null;
};

export async function listTodoRecurrences(
  supabase: SupabaseClient,
  userId: string,
): Promise<TodoRecurrence[]> {
  const { data, error } = await supabase
    .from("todo_recurrences")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as TodoRecurrence[]) ?? [];
}

export async function createTodoRecurrence(
  supabase: SupabaseClient,
  userId: string,
  input: TodoRecurrenceInput,
): Promise<TodoRecurrence> {
  const { data, error } = await supabase
    .from("todo_recurrences")
    .insert({ user_id: userId, ...input })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as TodoRecurrence;
}

/** Delete a recurrence. Already-materialised todos are kept — the FK is
 *  `on delete set null`, so they just lose their repeat link. */
export async function deleteTodoRecurrence(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await supabase.from("todo_recurrences").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ----------------------------------------------------------------------------
// Materialisation
// ----------------------------------------------------------------------------

/**
 * For each recurrence, INSERT all due todos up to `today` and update
 * `last_materialised_on`. Idempotent: duplicates are rejected by the unique
 * index on (recurrence_id, recurrence_due_on) and silently skipped, so
 * concurrent runs (StrictMode double-effects, two tabs) can't double-insert.
 */
export async function materialiseDueTodoRecurrences(
  supabase: SupabaseClient,
  userId: string,
  today: Date = new Date(),
): Promise<number> {
  const { data: recs, error } = await supabase
    .from("todo_recurrences")
    .select("*")
    .eq("user_id", userId);
  if (error || !recs) return 0;

  let inserted = 0;

  for (const r of recs as TodoRecurrence[]) {
    if (!Number.isInteger(r.interval_n) || r.interval_n < 1) continue;
    // Day-of-month anchor so monthly/yearly schedules don't drift off the
    // start date when clamped by short months.
    const anchorDay = parseYmd(r.start_on).getDate();
    let cursor: Date;
    if (r.last_materialised_on) {
      cursor = nextDueDate(
        parseYmd(r.last_materialised_on),
        r.frequency,
        r.interval_n,
        anchorDay,
      );
    } else {
      cursor = parseYmd(r.start_on);
    }
    // Backfill up to today, or up to end_on if the recurrence has ended —
    // an ended recurrence may still have unmaterialised occurrences.
    const cap = r.end_on ? parseYmd(r.end_on) : today;
    const upperBound = cap < today ? cap : today;
    const upperYmd = ymd(upperBound);

    const t = r.template_json as TodoRecurrenceTemplate;
    const toInsert: Array<Partial<Todo>> = [];
    let lastOccurrence: string | null = null;
    while (ymd(cursor) <= upperYmd) {
      lastOccurrence = ymd(cursor);
      toInsert.push({
        user_id: userId,
        title: t.title,
        description: t.description ?? null,
        priority: t.priority,
        estimated_min: t.estimated_min ?? null,
        due_at: occurrenceDueAtIso(lastOccurrence, t.due_time ?? DEFAULT_DUE_TIME),
        is_done: false,
        recurrence_id: r.id,
        recurrence_due_on: lastOccurrence,
        // Land materialised todos in the recurrence's space (null = Inbox).
        space_id: r.space_id ?? null,
      });
      cursor = nextDueDate(cursor, r.frequency, r.interval_n, anchorDay);
    }

    if (toInsert.length > 0 && lastOccurrence) {
      const { error: insErr } = await supabase.from("todos").upsert(toInsert, {
        onConflict: "recurrence_id,recurrence_due_on",
        ignoreDuplicates: true,
      });
      if (!insErr) {
        inserted += toInsert.length;
        // Anchor to the last generated occurrence, not today — anchoring to
        // today would shift the whole schedule to whatever day the user
        // happened to open the app.
        await supabase
          .from("todo_recurrences")
          .update({ last_materialised_on: lastOccurrence })
          .eq("id", r.id);
      }
    }
  }
  return inserted;
}

/** Human label for a recurrence: "Every day", "Every 2 weeks", … */
export function recurrenceLabel(r: Pick<TodoRecurrence, "frequency" | "interval_n">): string {
  const unit: Record<Frequency, string> = {
    daily: "day",
    weekly: "week",
    monthly: "month",
    yearly: "year",
  };
  const u = unit[r.frequency];
  return r.interval_n === 1 ? `Every ${u}` : `Every ${r.interval_n} ${u}s`;
}
