// Coding Problem Tracker — URL parsing, metadata fetch, and Supabase CRUD.
//
// Storage was promoted from localStorage to the `coding_problems` /
// `learn_phases` tables (see 20260803000002_job_prep_and_planner.sql).
// `importFromLocalStorage` migrates any legacy browser-local data exactly
// once, idempotently, without deleting the originals (they're renamed to a
// `-imported-backup` suffix so the data is never lost).

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CodingProblemRow,
  Difficulty,
  LearnPhaseRow,
  LearnPhaseStage,
  PrepTrack,
  ProblemStatus,
} from "@/types";

// Legacy consumers imported these from this module — keep them re-exported.
export type { Difficulty, LearnPhaseStage, ProblemStatus } from "@/types";

/** Shape of a problem as stored by the old localStorage-only MVP. */
export interface CodingProblem {
  id: string;
  url: string;
  title: string;
  platform: string;
  difficulty: Difficulty;
  status: ProblemStatus;
  tags: string[];
  /** ISO date (YYYY-MM-DD) the problem was solved, or null if not yet. */
  solved_on: string | null;
  notes: string | null;
  created_at: string; // ISO datetime
}

/** Shape of a learn phase as stored by the old localStorage-only MVP. */
export interface LearnPhase {
  id: string;
  topic: string;
  stage: LearnPhaseStage;
  started_on: string;
  completed_on: string | null;
  notes: string | null;
  created_at: string;
}

/** Storage keys follow the existing `daily-rhythm-*` convention used by
 *  useTheme and the sidebar collapse flag. */
export const LEGACY_PROBLEMS_KEY = "daily-rhythm-coding-problems";
export const LEGACY_PHASES_KEY = "daily-rhythm-learn-phases";

/* ───────────────────────── Supabase CRUD ──────────────────────────── */

/** True for Postgres unique-constraint violations (double add, re-import). */
function isUniqueViolation(err: { code?: string | null } | null): boolean {
  return err?.code === "23505";
}

export type ProblemInput = {
  url: string;
  title: string;
  platform: string;
  difficulty: Difficulty;
  status: ProblemStatus;
  tags: string[];
  companies: string[];
  solved_on: string | null;
  notes: string | null;
};

export async function listProblems(
  supabase: SupabaseClient,
  userId: string,
): Promise<CodingProblemRow[]> {
  const { data, error } = await supabase
    .from("coding_problems")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as CodingProblemRow[]) ?? [];
}

export async function insertProblem(
  supabase: SupabaseClient,
  userId: string,
  input: ProblemInput,
): Promise<CodingProblemRow> {
  const { data, error } = await supabase
    .from("coding_problems")
    .insert({ user_id: userId, ...input })
    .select()
    .single();
  if (error) {
    throw new Error(
      isUniqueViolation(error)
        ? "You already track this problem."
        : error.message,
    );
  }
  return data as CodingProblemRow;
}

export async function updateProblem(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<ProblemInput> & {
    last_revised_on?: string | null;
    revise_count?: number;
  },
): Promise<CodingProblemRow> {
  const { data, error } = await supabase
    .from("coding_problems")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    throw new Error(
      isUniqueViolation(error)
        ? "You already track this problem."
        : error.message,
    );
  }
  return data as CodingProblemRow;
}

export async function deleteProblem(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await supabase.from("coding_problems").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export type PhaseInput = {
  topic: string;
  stage: LearnPhaseStage;
  track?: PrepTrack;
  started_on: string;
  target_on?: string | null;
  completed_on: string | null;
  notes: string | null;
};

export async function listPhases(
  supabase: SupabaseClient,
  userId: string,
): Promise<LearnPhaseRow[]> {
  const { data, error } = await supabase
    .from("learn_phases")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as LearnPhaseRow[]) ?? [];
}

export async function insertPhase(
  supabase: SupabaseClient,
  userId: string,
  input: PhaseInput,
): Promise<LearnPhaseRow> {
  const { data, error } = await supabase
    .from("learn_phases")
    .insert({ user_id: userId, ...input })
    .select()
    .single();
  if (error) {
    throw new Error(
      isUniqueViolation(error)
        ? "You already track this topic."
        : error.message,
    );
  }
  return data as LearnPhaseRow;
}

export async function updatePhase(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<PhaseInput>,
): Promise<LearnPhaseRow> {
  const { data, error } = await supabase
    .from("learn_phases")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    throw new Error(
      isUniqueViolation(error)
        ? "You already track this topic."
        : error.message,
    );
  }
  return data as LearnPhaseRow;
}

export async function deletePhase(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await supabase.from("learn_phases").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* ─────────────── one-time localStorage → Supabase import ──────────── */

const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];
const STATUSES: readonly ProblemStatus[] = ["todo", "in_progress", "solved"];
const STAGES: readonly LearnPhaseStage[] = [
  "learning",
  "practicing",
  "reviewing",
  "mastered",
];

function readLegacyJson<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    // Corrupt JSON — nothing importable; leave the key untouched.
    return [];
  }
}

/** Rename a legacy key to `<key>-imported-backup` — the original data is
 *  preserved verbatim, but the app stops seeing it as pending import. */
function backupLegacyKey(key: string): void {
  if (typeof window === "undefined") return;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return;
  window.localStorage.setItem(`${key}-imported-backup`, raw);
  window.localStorage.removeItem(key);
}

/**
 * Migrate legacy browser-local problems / phases into Supabase.
 *
 * Idempotent: rows upsert against the natural-key unique indexes with
 * `ignoreDuplicates`, and the legacy keys are renamed (never deleted) only
 * after BOTH upserts succeed — so a re-run after any failure retries safely,
 * and a re-run after success is a no-op.
 */
export async function importFromLocalStorage(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ problems: number; phases: number }> {
  const legacyProblems = readLegacyJson<CodingProblem>(LEGACY_PROBLEMS_KEY);
  const legacyPhases = readLegacyJson<LearnPhase>(LEGACY_PHASES_KEY);
  if (legacyProblems.length === 0 && legacyPhases.length === 0) {
    return { problems: 0, phases: 0 };
  }

  const problemRows = legacyProblems
    .filter((p) => typeof p?.url === "string" && p.url.trim())
    .map((p) => ({
      user_id: userId,
      url: p.url.trim(),
      title: p.title || p.url.trim(),
      platform: p.platform ?? "",
      difficulty: DIFFICULTIES.includes(p.difficulty) ? p.difficulty : "medium",
      status: STATUSES.includes(p.status) ? p.status : "todo",
      tags: normaliseTags(Array.isArray(p.tags) ? p.tags : []),
      companies: [] as string[],
      solved_on: p.solved_on ?? null,
      last_revised_on: null,
      revise_count: 0,
      notes: p.notes ?? null,
      created_at: p.created_at ?? new Date().toISOString(),
    }));

  const phaseRows = legacyPhases
    .filter((p) => typeof p?.topic === "string" && p.topic.trim())
    .map((p) => ({
      user_id: userId,
      topic: p.topic.trim(),
      stage: STAGES.includes(p.stage) ? p.stage : "learning",
      started_on: p.started_on || (p.created_at ?? new Date().toISOString()).slice(0, 10),
      completed_on: p.completed_on ?? null,
      notes: p.notes ?? null,
      created_at: p.created_at ?? new Date().toISOString(),
    }));

  if (problemRows.length > 0) {
    const { error } = await supabase
      .from("coding_problems")
      .upsert(problemRows, { onConflict: "user_id,url", ignoreDuplicates: true });
    if (error) throw new Error(`Import failed: ${error.message}`);
  }
  if (phaseRows.length > 0) {
    const { error } = await supabase
      .from("learn_phases")
      .upsert(phaseRows, { onConflict: "user_id,topic", ignoreDuplicates: true });
    if (error) throw new Error(`Import failed: ${error.message}`);
  }

  // Both upserts succeeded — retire the legacy keys (keep the data as backup).
  backupLegacyKey(LEGACY_PROBLEMS_KEY);
  backupLegacyKey(LEGACY_PHASES_KEY);

  return { problems: problemRows.length, phases: phaseRows.length };
}

/* ─────────────────────────── URL detection ────────────────────────── */

/** Recognised competitive-programming / interview platforms. Adding a new one
 *  is a single entry — keep the host check loose (endsWith) so subdomains like
 *  `www.` or country variants don't break detection. */
const PLATFORMS: { host: string; name: string; slugAt?: number }[] = [
  { host: "leetcode.com", name: "LeetCode", slugAt: 1 }, // /problems/<slug>
  { host: "hackerrank.com", name: "HackerRank", slugAt: 1 }, // /challenges/<slug>
  { host: "codeforces.com", name: "Codeforces" },
  { host: "atcoder.jp", name: "AtCoder" },
  { host: "codechef.com", name: "CodeChef" },
  // GFG: /problems/<slug>/<numeric-id> — slug lives at index 1, not the
  // trailing id, so we pin slugAt explicitly.
  { host: "geeksforgeeks.org", name: "GeeksforGeeks", slugAt: 1 },
  { host: "interviewbit.com", name: "InterviewBit" },
  { host: "hackerearth.com", name: "HackerEarth" },
  { host: "topcoder.com", name: "Topcoder" },
];

export interface ParsedUrl {
  platform: string;
  /** Best-effort title derived from the URL slug — user can override before saving. */
  titleGuess: string;
}

/** Inspect a problem URL and pull out the platform name plus a guessed title.
 *  Falls back to the URL host when no platform pattern matches. Title fallback
 *  is the last non-empty path segment with dashes/underscores → spaces. */
export function parseProblemUrl(raw: string): ParsedUrl {
  const trimmed = raw.trim();
  if (!trimmed) return { platform: "", titleGuess: "" };
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { platform: "", titleGuess: "" };
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const segments = u.pathname.split("/").filter(Boolean);
  const match = PLATFORMS.find((p) => host === p.host || host.endsWith(`.${p.host}`));
  const platform = match?.name ?? host;
  // Prefer the configured slug index (e.g. LeetCode's /problems/<slug>) and
  // fall back to the last *non-numeric* segment so trailing problem-ids like
  // GFG's `/problems/reverse-an-array/1` don't surface as just "1".
  const isNumeric = (s: string) => /^\d+$/.test(s);
  let slug = match?.slugAt !== undefined ? segments[match.slugAt] : undefined;
  if (!slug || isNumeric(slug)) {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i] && !isNumeric(segments[i])) {
        slug = segments[i];
        break;
      }
    }
  }
  slug = slug ?? "";
  const titleGuess = slug
    .replace(/\.(html?|aspx?)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  return { platform, titleGuess };
}

/* ───────────────────── live-fetch problem metadata ────────────────── */

export interface FetchedMeta {
  title?: string;
  difficulty?: Difficulty;
  tags?: string[];
  notes?: string;
}

/** Browsers can't fetch LeetCode/GFG/Codeforces directly because those sites
 *  don't send permissive CORS headers. `r.jina.ai` is a free content-reader
 *  proxy that fetches the URL server-side, runs basic JS rendering, and
 *  returns a clean markdown rendition with `Access-Control-Allow-Origin: *`,
 *  so the browser can read the response.
 *
 *  This is best-effort: if the proxy is down, rate-limited, or the page has
 *  no recognisable difficulty/tags markup, we return whatever we did find.
 *  The caller should merge with whatever the user has already typed. */
const READER_PROXY = "https://r.jina.ai/";

export async function fetchProblemMeta(
  url: string,
  signal?: AbortSignal,
): Promise<FetchedMeta> {
  const trimmed = url.trim();
  if (!trimmed) return {};
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {};
  }
  try {
    const res = await fetch(`${READER_PROXY}${parsed.toString()}`, {
      signal,
      // jina returns plain text/markdown
      headers: { Accept: "text/plain" },
    });
    if (!res.ok) return {};
    const md = await res.text();
    return extractMetaFromMarkdown(md);
  } catch {
    return {};
  }
}

/** Strip platform suffixes ("- LeetCode", " | GeeksforGeeks", etc.) that
 *  search-engine titles tend to carry. */
const PLATFORM_SUFFIX_RE =
  /\s*[-|–·]\s*(LeetCode|GeeksforGeeks|GFG|HackerRank|Codeforces|AtCoder|CodeChef|InterviewBit|HackerEarth|Topcoder).*$/i;

/** Difficulty literals we recognise in scraped markdown. GFG uses additional
 *  "Basic"/"School" buckets — collapse those into "easy" so we don't have to
 *  invent extra difficulty levels in the domain type. */
const DIFFICULTY_WORD: Record<string, Difficulty> = {
  easy: "easy",
  basic: "easy",
  school: "easy",
  medium: "medium",
  hard: "hard",
};

/** Pull title/difficulty/tags from a jina markdown rendering. Each pattern is
 *  isolated so a miss on one field never blocks the others — partial data is
 *  better than nothing. */
function extractMetaFromMarkdown(md: string): FetchedMeta {
  const out: FetchedMeta = {};

  // ── Title ──────────────────────────────────────────────────────────
  // jina prepends a literal `Title: …` line above the markdown body, which
  // is the cleanest source. Fall back to the first H1.
  const titleHeader = md.match(/^Title:\s*(.+)$/m);
  const titleH1 = md.match(/^#\s+(.+)$/m);
  const rawTitle = (titleHeader?.[1] ?? titleH1?.[1] ?? "").trim();
  if (rawTitle) {
    out.title = rawTitle.replace(PLATFORM_SUFFIX_RE, "").trim();
  }

  // ── Difficulty ────────────────────────────────────────────────────
  // Restrict the search window to the first ~6KB so we don't latch onto the
  // word "Hard" from a user comment further down the page.
  const head = md.slice(0, 6000);
  const labelled = head.match(/Difficulty\s*[:|\-–]?\s*(Easy|Medium|Hard|Basic|School)/i);
  const loose = labelled ? null : head.match(/\b(Easy|Medium|Hard|Basic|School)\b/);
  const diffWord = (labelled?.[1] ?? loose?.[1] ?? "").toLowerCase();
  if (diffWord && DIFFICULTY_WORD[diffWord]) {
    out.difficulty = DIFFICULTY_WORD[diffWord];
  }

  // ── Tags / topics ─────────────────────────────────────────────────
  // Most platforms label their topic list with "Topics", "Topic Tags", or
  // "Tags". After the label, the values appear either as comma-separated
  // text or as markdown links `[Array](…)`.
  const tagsLine = head.match(
    /(?:Related Topics|Topic Tags?|Topics?|Tags?|Categories)\s*[:|\-–]?\s*([^\n]{0,600})/i,
  );
  if (tagsLine) {
    const segment = tagsLine[1];
    const tags: string[] = [];
    const linkRe = /\[([^\]]+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(segment)) && tags.length < 12) tags.push(m[1]);
    if (tags.length === 0) {
      tags.push(...segment.split(/[,;|]/).slice(0, 12));
    }
    const cleaned = tags
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 1 && t.length < 40 && !/^[\d.]+$/.test(t));
    if (cleaned.length > 0) out.tags = normaliseTags(cleaned);
  }

  return out;
}

/* ─────────────────────────── tag helpers ──────────────────────────── */

/** Normalise raw tag input: trim, lowercase, dedupe, drop empties. */
export function normaliseTags(input: string | string[]): string[] {
  const arr = Array.isArray(input) ? input : input.split(",");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of arr) {
    const k = t.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/** Count tag occurrences across all problems — used to rank tag chips and to
 *  power the "Top tags" summary card. */
export function tagFrequencies(
  problems: Array<Pick<CodingProblemRow, "tags">>,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of problems) {
    for (const t of p.tags) m.set(t, (m.get(t) ?? 0) + 1);
  }
  return m;
}

/** Count company-tag occurrences — powers the company filter chips. */
export function companyFrequencies(
  problems: Array<Pick<CodingProblemRow, "companies">>,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of problems) {
    for (const c of p.companies ?? []) m.set(c, (m.get(c) ?? 0) + 1);
  }
  return m;
}

/* ─────────────────────────── streak math ──────────────────────────── */

/**
 * Current consecutive-day streak of solved problems. A streak isn't broken
 * until midnight: if nothing is solved *today yet*, count back from
 * yesterday — matching `computeStreak` in DailyRoutine.
 */
export function currentStreak(
  problems: Array<Pick<CodingProblemRow, "solved_on">>,
  today = new Date(),
): number {
  const solved = new Set(
    problems.filter((p) => p.solved_on).map((p) => p.solved_on as string),
  );
  if (solved.size === 0) return 0;
  let streak = 0;
  const cursor = new Date(today);
  // Anchor at midnight to avoid timezone drift while iterating.
  cursor.setHours(0, 0, 0, 0);
  if (!solved.has(ymd(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (solved.has(ymd(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ─────────────────────────── id helper ────────────────────────────── */

export function newId(): string {
  // crypto.randomUUID is widely available in all evergreen browsers + Node 19+.
  // The typeof guard handles a few stale runtimes / test envs.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/* ─────────────────────────── label maps ───────────────────────────── */

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

export const STATUS_LABEL: Record<ProblemStatus, string> = {
  todo: "Todo",
  in_progress: "In progress",
  solved: "Solved",
};

export const PHASE_LABEL: Record<LearnPhaseStage, string> = {
  learning: "Learning",
  practicing: "Practicing",
  reviewing: "Reviewing",
  mastered: "Mastered",
};
