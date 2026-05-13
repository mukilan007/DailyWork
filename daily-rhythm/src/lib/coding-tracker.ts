// Coding Problem Tracker — domain types, URL parsing, and localStorage I/O.
//
// Storage is intentionally local-only for the MVP so the feature ships without
// requiring a Supabase migration. When promoted to a server table the shape of
// `CodingProblem` and `LearnPhase` already matches what the columns will be —
// just swap `loadProblems` / `saveProblems` for typed supabase.from() calls and
// add `user_id` to the rows.

export type Difficulty = "easy" | "medium" | "hard";

export type ProblemStatus = "todo" | "in_progress" | "solved";

export type LearnPhaseStage =
  | "learning"
  | "practicing"
  | "reviewing"
  | "mastered";

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

export interface LearnPhase {
  id: string;
  topic: string;
  stage: LearnPhaseStage;
  /** ISO date the phase started. */
  started_on: string;
  /** ISO date the phase wrapped up, or null while still in progress. */
  completed_on: string | null;
  notes: string | null;
  created_at: string;
}

/** Storage keys follow the existing `daily-rhythm-*` convention used by
 *  useTheme and the sidebar collapse flag. */
const PROBLEMS_KEY = "daily-rhythm-coding-problems";
const PHASES_KEY = "daily-rhythm-learn-phases";

/* ──────────────────────────── persistence ─────────────────────────── */

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    // Corrupt JSON — start fresh rather than crash the page.
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function loadProblems(): CodingProblem[] {
  return readJson<CodingProblem[]>(PROBLEMS_KEY, []);
}
export function saveProblems(rows: CodingProblem[]): void {
  writeJson(PROBLEMS_KEY, rows);
}

export function loadPhases(): LearnPhase[] {
  return readJson<LearnPhase[]>(PHASES_KEY, []);
}
export function savePhases(rows: LearnPhase[]): void {
  writeJson(PHASES_KEY, rows);
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
export function tagFrequencies(problems: CodingProblem[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of problems) {
    for (const t of p.tags) m.set(t, (m.get(t) ?? 0) + 1);
  }
  return m;
}

/* ─────────────────────────── streak math ──────────────────────────── */

/** Current consecutive-day streak of solved problems, anchored to today. */
export function currentStreak(problems: CodingProblem[], today = new Date()): number {
  const solved = new Set(
    problems.filter((p) => p.solved_on).map((p) => p.solved_on as string),
  );
  if (solved.size === 0) return 0;
  let streak = 0;
  const cursor = new Date(today);
  // Anchor at midnight to avoid timezone drift while iterating.
  cursor.setHours(0, 0, 0, 0);
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
