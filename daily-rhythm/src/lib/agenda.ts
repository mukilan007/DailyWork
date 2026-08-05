// Smart Daily Agenda engine.
//
// Pure builders (`buildAgenda`, `planDay`, `findNextFreeStart`,
// `computeSolveStreak`) take prefetched rows + an explicit `today`, so they
// are unit-testable without a Supabase client. Fetch helpers
// (`fetchAgendaData`, `markRevised`, `useFreeze`) wrap the small amount of
// I/O the Home card and the /today planner share.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Activity,
  ActivityCompletion,
  CodingProblemRow,
  JobApplication,
  PlannerBlockKind,
  Todo,
  UserSettings,
} from "@/types";
import { addDays, parseYmd, weekDates, ymd } from "@/lib/dates";

// ---------------------------------------------------------------------------
// Lean row shapes — only the columns the agenda actually reads, so queries
// can select narrow column lists on the bigger tables.
// ---------------------------------------------------------------------------

export type AgendaCompletion = Pick<ActivityCompletion, "activity_id" | "completed_on">;

export type AgendaProblem = Pick<
  CodingProblemRow,
  | "id"
  | "title"
  | "url"
  | "platform"
  | "difficulty"
  | "solved_on"
  | "last_revised_on"
  | "revise_count"
>;

export type AgendaFollowUp = Pick<
  JobApplication,
  "id" | "company" | "role" | "stage" | "follow_up_on"
>;

export interface AgendaInputs {
  /** Open todos due before the end of today (server-side filtered). */
  todos: Todo[];
  activities: Activity[];
  /** Completions from the start of the current Mon–Sun week onward. */
  completions: AgendaCompletion[];
  /** All solved problems (needed for streak history, not just today). */
  problems: AgendaProblem[];
  applications: AgendaFollowUp[];
  settings: UserSettings | null;
}

export interface SolveGoal {
  solvedToday: number;
  target: number;
  met: boolean;
}

export interface AgendaData {
  overdueTodos: Todo[];
  todayTodos: Todo[];
  habitsDue: Activity[];
  /** Spaced-repetition revisions due today, oldest-solved first. */
  revisions: AgendaProblem[];
  followUpsDue: AgendaFollowUp[];
  solveGoal: SolveGoal;
  /** Current solve streak in days, freeze-aware. */
  streak: number;
  freezesUsedThisMonth: number;
  /** True when freezing yesterday would restore a broken streak and a
   *  freeze is still available for yesterday's calendar month. */
  canFreezeYesterday: boolean;
}

// ---------------------------------------------------------------------------
// Spaced repetition + streak rules
// ---------------------------------------------------------------------------

/** Days after `solved_on` at which revision N (0-based) becomes due.
 *  After 3 revisions a problem is considered retained. */
export const REVISE_INTERVALS = [7, 30, 90] as const;

/** Streak freezes allowed per calendar month. */
export const FREEZES_PER_MONTH = 2;

/** Whole days from local-midnight `from` to local-midnight `to`.
 *  Rounded so a DST hour shift can't skew the count. */
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function freezesUsedInMonth(freezeDates: string[], anyYmdInMonth: string): number {
  const month = anyYmdInMonth.slice(0, 7); // YYYY-MM
  return freezeDates.filter((d) => d.slice(0, 7) === month).length;
}

/**
 * Consecutive-day solve streak ending today (or yesterday when today has no
 * solve yet, so the streak doesn't collapse mid-day). Freeze days are
 * stepped over without incrementing the streak.
 */
export function computeSolveStreak(
  solvedDates: ReadonlySet<string>,
  freezeDates: ReadonlySet<string>,
  today: Date = new Date()
): number {
  let cursor = new Date(today);
  cursor.setHours(0, 0, 0, 0);
  if (!solvedDates.has(ymd(cursor))) cursor = addDays(cursor, -1);
  let streak = 0;
  // Hard cap ≈ 20 years so corrupt data can never loop forever.
  for (let guard = 0; guard < 7500; guard++) {
    const key = ymd(cursor);
    if (solvedDates.has(key)) {
      streak += 1;
    } else if (!freezeDates.has(key)) {
      break;
    }
    cursor = addDays(cursor, -1);
  }
  return streak;
}

// ---------------------------------------------------------------------------
// buildAgenda — pure
// ---------------------------------------------------------------------------

export function buildAgenda(inputs: AgendaInputs, today: Date = new Date()): AgendaData {
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);
  const todayY = ymd(startOfToday);
  const yesterdayY = ymd(addDays(startOfToday, -1));
  const weekKeys = new Set(weekDates(startOfToday).map((d) => ymd(d)));

  // --- Todos -----------------------------------------------------------
  const dueTime = (t: Todo) => new Date(t.due_at!).getTime();
  const openWithDue = inputs.todos.filter((t) => !t.is_done && t.due_at);
  const overdueTodos = openWithDue
    .filter((t) => dueTime(t) < startOfToday.getTime())
    .sort((a, b) => dueTime(a) - dueTime(b));
  const todayTodos = openWithDue
    .filter((t) => ymd(new Date(t.due_at!)) === todayY)
    .sort((a, b) => dueTime(a) - dueTime(b));

  // --- Habits ----------------------------------------------------------
  const completedToday = new Set(
    inputs.completions.filter((c) => c.completed_on === todayY).map((c) => c.activity_id)
  );
  const completedThisWeek = new Set(
    inputs.completions.filter((c) => weekKeys.has(c.completed_on)).map((c) => c.activity_id)
  );
  const habitsDue = inputs.activities.filter((a) => {
    if (a.is_archived) return false;
    if (a.frequency === "daily") return !completedToday.has(a.id);
    if (a.frequency === "weekly") return !completedThisWeek.has(a.id);
    return false; // "custom" cadence has no due rule
  });

  // --- Spaced-repetition revisions --------------------------------------
  const revisions = inputs.problems
    .filter((p) => {
      if (!p.solved_on) return false;
      if (p.revise_count >= REVISE_INTERVALS.length) return false; // retained
      if (p.last_revised_on === todayY) return false; // already revised today
      const interval = REVISE_INTERVALS[p.revise_count];
      return daysBetween(parseYmd(p.solved_on), startOfToday) >= interval;
    })
    .sort((a, b) => a.solved_on!.localeCompare(b.solved_on!));

  // --- Job-application follow-ups ---------------------------------------
  const followUpsDue = inputs.applications
    .filter(
      (j) =>
        j.follow_up_on !== null &&
        j.follow_up_on <= todayY &&
        j.stage !== "offer" &&
        j.stage !== "rejected"
    )
    .sort((a, b) => a.follow_up_on!.localeCompare(b.follow_up_on!));

  // --- Solve goal + streak ----------------------------------------------
  const solvedDates = new Set(
    inputs.problems.filter((p) => p.solved_on).map((p) => p.solved_on!)
  );
  const solvedToday = inputs.problems.filter((p) => p.solved_on === todayY).length;
  const target = Math.max(1, inputs.settings?.daily_solve_target ?? 1);
  const solveGoal: SolveGoal = { solvedToday, target, met: solvedToday >= target };

  const freezeList = inputs.settings?.freeze_dates ?? [];
  const freezeSet = new Set(freezeList);
  const streak = computeSolveStreak(solvedDates, freezeSet, startOfToday);
  const freezesUsedThisMonth = freezesUsedInMonth(freezeList, todayY);

  // Yesterday broke (or is about to break) the streak: offer a freeze when
  // one is still available for yesterday's month and it would actually
  // reconnect the chain.
  const yesterdayMissed = !solvedDates.has(yesterdayY) && !freezeSet.has(yesterdayY);
  const freezeLeftForYesterday =
    freezesUsedInMonth(freezeList, yesterdayY) < FREEZES_PER_MONTH;
  const canFreezeYesterday =
    yesterdayMissed &&
    freezeLeftForYesterday &&
    computeSolveStreak(solvedDates, new Set([...freezeSet, yesterdayY]), startOfToday) > streak;

  return {
    overdueTodos,
    todayTodos,
    habitsDue,
    revisions,
    followUpsDue,
    solveGoal,
    streak,
    freezesUsedThisMonth,
    canFreezeYesterday,
  };
}

// ---------------------------------------------------------------------------
// Free-slot planning — pure
// ---------------------------------------------------------------------------

export interface BlockSpan {
  start_min: number;
  duration_min: number;
}

export interface PlanCandidate {
  title: string;
  kind: PlannerBlockKind;
  ref_id: string | null;
  duration_min: number;
}

/** Auto-plan window: 09:00–21:00. */
export const PLAN_WINDOW_START = 9 * 60;
export const PLAN_WINDOW_END = 21 * 60;

function overlaps(startMin: number, durationMin: number, b: BlockSpan): boolean {
  return startMin < b.start_min + b.duration_min && b.start_min < startMin + durationMin;
}

/**
 * First hour-aligned start in [windowStart, windowEnd) where a block of
 * `durationMin` fits without overlapping `existing`. Null when nothing fits.
 */
export function findNextFreeStart(
  existing: readonly BlockSpan[],
  durationMin: number,
  windowStart: number,
  windowEnd: number
): number | null {
  // Align the scan to the hour grid so results are deterministic.
  const first = Math.ceil(Math.max(0, windowStart) / 60) * 60;
  for (let start = first; start + durationMin <= windowEnd; start += 60) {
    if (!existing.some((b) => overlaps(start, durationMin, b))) return start;
  }
  return null;
}

/**
 * Deterministically place up to `maxItems` candidates (already in priority
 * order) into free hour-aligned slots between 09:00 and 21:00, skipping
 * ranges occupied by `existing` blocks. Candidates that don't fit are
 * skipped; later (shorter) ones may still be placed.
 */
export function planDay(
  candidates: readonly PlanCandidate[],
  existing: readonly BlockSpan[],
  maxItems = 5,
  windowStart = PLAN_WINDOW_START,
  windowEnd = PLAN_WINDOW_END
): (PlanCandidate & { start_min: number })[] {
  const occupied: BlockSpan[] = [...existing];
  const placed: (PlanCandidate & { start_min: number })[] = [];
  for (const c of candidates) {
    if (placed.length >= maxItems) break;
    const start = findNextFreeStart(occupied, c.duration_min, windowStart, windowEnd);
    if (start === null) continue;
    occupied.push({ start_min: start, duration_min: c.duration_min });
    placed.push({ ...c, start_min: start });
  }
  return placed;
}

// ---------------------------------------------------------------------------
// Fetch + mutation helpers
// ---------------------------------------------------------------------------

export interface AgendaFetchResult {
  inputs: AgendaInputs;
  agenda: AgendaData;
  /** First query error message, or null when everything succeeded. */
  error: string | null;
}

/**
 * Runs every agenda query in parallel and returns both the raw inputs and
 * the built agenda. Queries stay lean: narrow column lists and server-side
 * filters where cheap.
 */
export async function fetchAgendaData(
  client: SupabaseClient,
  userId: string,
  today: Date = new Date()
): Promise<AgendaFetchResult> {
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrowIso = addDays(startOfToday, 1).toISOString();
  const todayY = ymd(startOfToday);
  const weekStartYmd = ymd(weekDates(startOfToday)[0]);

  const [todosRes, activitiesRes, completionsRes, problemsRes, appsRes, settingsRes] =
    await Promise.all([
      client
        .from("todos")
        .select("id,user_id,title,is_done,created_at,description,due_at,priority,estimated_min")
        .eq("is_done", false)
        .not("due_at", "is", null)
        .lt("due_at", startOfTomorrowIso),
      // `select *` here on purpose: the table is tiny and some DBs may not
      // have the `is_archived` column yet — buildAgenda filters client-side.
      client.from("activities").select("*"),
      client
        .from("activity_completions")
        .select("activity_id,completed_on")
        .gte("completed_on", weekStartYmd),
      client
        .from("coding_problems")
        .select("id,title,url,platform,difficulty,solved_on,last_revised_on,revise_count")
        .not("solved_on", "is", null),
      client
        .from("job_applications")
        .select("id,company,role,stage,follow_up_on")
        .not("follow_up_on", "is", null)
        .lte("follow_up_on", todayY)
        .not("stage", "in", "(offer,rejected)"),
      client.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
    ]);

  const error =
    todosRes.error?.message ??
    activitiesRes.error?.message ??
    completionsRes.error?.message ??
    problemsRes.error?.message ??
    appsRes.error?.message ??
    settingsRes.error?.message ??
    null;

  const inputs: AgendaInputs = {
    todos: (todosRes.data ?? []) as Todo[],
    activities: (activitiesRes.data ?? []) as Activity[],
    completions: (completionsRes.data ?? []) as AgendaCompletion[],
    problems: (problemsRes.data ?? []) as AgendaProblem[],
    applications: (appsRes.data ?? []) as AgendaFollowUp[],
    settings: (settingsRes.data as UserSettings | null) ?? null,
  };

  return { inputs, agenda: buildAgenda(inputs, today), error };
}

/**
 * Record a spaced-repetition revision: stamps `last_revised_on = today` and
 * bumps `revise_count`. Returns an error message or null.
 */
export async function markRevised(
  client: SupabaseClient,
  problem: Pick<CodingProblemRow, "id" | "revise_count">
): Promise<{ error: string | null }> {
  const { error } = await client
    .from("coding_problems")
    .update({ last_revised_on: ymd(), revise_count: problem.revise_count + 1 })
    .eq("id", problem.id);
  return { error: error?.message ?? null };
}

/**
 * Add `dateYmd` to the user's streak-freeze dates (max 2 per calendar
 * month — refused with a friendly message beyond that). Idempotent when the
 * date is already frozen. Returns the updated freeze list on success.
 */
export async function useFreeze(
  client: SupabaseClient,
  userId: string,
  settings: UserSettings | null,
  dateYmd: string
): Promise<{ error: string | null; freezeDates: string[] }> {
  const existing = settings?.freeze_dates ?? [];
  if (existing.includes(dateYmd)) return { error: null, freezeDates: existing };
  if (freezesUsedInMonth(existing, dateYmd) >= FREEZES_PER_MONTH) {
    return {
      error: `You've already used both streak freezes for that month.`,
      freezeDates: existing,
    };
  }
  const next = [...existing, dateYmd].sort();
  const { error } = await client
    .from("user_settings")
    .upsert({ user_id: userId, freeze_dates: next }, { onConflict: "user_id" });
  if (error) return { error: error.message, freezeDates: existing };
  return { error: null, freezeDates: next };
}
