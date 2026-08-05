// Auto-analysis insights engine — pure functions over prefetched arrays.
//
// `computeInsights` receives ~60 days of already-fetched rows and looks for
// correlations worth surfacing on the Weekly Review page. Every check has a
// minimum-sample guard (>= `minBucketDays` days in EACH bucket, default 5)
// and a strength threshold — when nothing passes, it returns [] rather than
// fabricating a pattern. No I/O happens here, so the whole file is testable.

import { addDays, parseYmd, startOfWeek, ymd } from "@/lib/dates";
import type {
  Activity,
  ActivityCompletion,
  CodingProblemRow,
  GlucoseReading,
  MoodLog,
  StudySession,
  Workout,
} from "@/types";

export type InsightStrength = "strong" | "moderate" | "weak";

export type Insight = {
  id: string;
  /** One-line headline, e.g. "You solve 1.8× more problems on gym days". */
  text: string;
  strength: InsightStrength;
  /** Supporting numbers — sample sizes and per-bucket averages. */
  detail: string;
};

export type InsightsData = {
  /** Active (non-archived) activities — used for habit-completion denominators. */
  activities: Activity[];
  completions: ActivityCompletion[];
  workouts: Workout[];
  problems: CodingProblemRow[];
  studySessions: StudySession[];
  moodLogs: MoodLog[];
  glucose: GlucoseReading[];
};

export type InsightsOptions = {
  /** Window size in days (default 60). */
  days?: number;
  /** "Now" anchor — injectable for tests (default: today). */
  today?: Date;
  /** Minimum days required in each comparison bucket (default 5). */
  minBucketDays?: number;
};

// ---------------------------------------------------------------------------
// Small exported helpers (testable building blocks)
// ---------------------------------------------------------------------------

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** The `days` YYYY-MM-DD keys ending at `today` (inclusive), oldest first. */
export function dayKeys(days: number, today: Date): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(ymd(addDays(today, -i)));
  return out;
}

/** Count rows per day. Rows whose key() returns null are skipped. */
export function countByDay<T>(rows: T[], key: (row: T) => string | null): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

/** Sum a numeric value per day. Rows whose key() returns null are skipped. */
export function sumByDay<T>(
  rows: T[],
  key: (row: T) => string | null,
  value: (row: T) => number
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + value(r));
  }
  return map;
}

/** Split day keys into two buckets by predicate — the core of every check. */
export function splitDays(
  days: string[],
  inA: (day: string) => boolean
): { a: string[]; b: string[] } {
  const a: string[] = [];
  const b: string[] = [];
  for (const d of days) (inA(d) ? a : b).push(d);
  return { a, b };
}

/**
 * Ratio of the larger mean over the smaller, with zero-guards.
 * Returns null when both means are 0 (nothing to compare).
 */
export function safeRatio(a: number, b: number): { ratio: number; aHigher: boolean } | null {
  if (a === 0 && b === 0) return null;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return { ratio: lo === 0 ? Infinity : hi / lo, aHigher: a >= b };
}

// ---------------------------------------------------------------------------
// Strength tiers
// ---------------------------------------------------------------------------

function strengthFromRatio(ratio: number): InsightStrength {
  if (ratio >= 2) return "strong";
  if (ratio >= 1.5) return "moderate";
  return "weak";
}

function strengthFromPoints(pts: number): InsightStrength {
  if (pts >= 30) return "strong";
  if (pts >= 20) return "moderate";
  return "weak";
}

function strengthFromDeviation(pct: number): InsightStrength {
  if (pct >= 60) return "strong";
  if (pct >= 40) return "moderate";
  return "weak";
}

/** Internal: an insight plus a comparable score for ranking. */
type Scored = { insight: Insight; score: number };

function ratioLabel(ratio: number): string {
  return ratio === Infinity ? "∞" : `${round1(ratio)}×`;
}

// ---------------------------------------------------------------------------
// Individual checks — each returns null when its guard or threshold fails
// ---------------------------------------------------------------------------

/** 1. Gym vs solves — mean problems solved on gym days vs non-gym days. */
function checkGymVsSolves(
  days: string[],
  workouts: Workout[],
  problems: CodingProblemRow[],
  minDays: number
): Scored | null {
  const gymDays = new Set(workouts.map((w) => ymd(new Date(w.performed_at))));
  const solves = countByDay(problems, (p) => p.solved_on);
  const { a: gym, b: rest } = splitDays(days, (d) => gymDays.has(d));
  if (gym.length < minDays || rest.length < minDays) return null;

  const gymMean = mean(gym.map((d) => solves.get(d) ?? 0));
  const restMean = mean(rest.map((d) => solves.get(d) ?? 0));
  const r = safeRatio(gymMean, restMean);
  if (!r || r.ratio < 1.3) return null;

  const where = r.aHigher ? "gym days" : "rest days";
  const text =
    r.ratio === Infinity
      ? `You only solve problems on ${where}`
      : `You solve ${round1(r.ratio)}× more problems on ${where}`;
  return {
    score: Math.min(r.ratio, 5),
    insight: {
      id: "gym-solves",
      text,
      strength: strengthFromRatio(r.ratio),
      detail: `${gym.length} gym days avg ${round1(gymMean)}/day vs ${rest.length} rest days avg ${round1(restMean)}/day (${ratioLabel(r.ratio)}).`,
    },
  };
}

/** 2. Morning mood vs habit completion rate (mood >= 4 vs <= 2). */
function checkMoodVsHabits(
  days: string[],
  moodLogs: MoodLog[],
  completions: ActivityCompletion[],
  activities: Activity[],
  minDays: number
): Scored | null {
  const dailyCount = activities.filter((a) => a.frequency === "daily" && !a.is_archived).length;
  if (dailyCount === 0) return null;

  const morning = new Map<string, number>();
  for (const m of moodLogs) if (m.slot === "morning") morning.set(m.log_date, m.mood);

  const done = countByDay(completions, (c) => c.completed_on);
  const high = days.filter((d) => (morning.get(d) ?? 0) >= 4);
  const low = days.filter((d) => {
    const m = morning.get(d);
    return m !== undefined && m <= 2;
  });
  if (high.length < minDays || low.length < minDays) return null;

  const rate = (bucket: string[]) =>
    mean(bucket.map((d) => Math.min(1, (done.get(d) ?? 0) / dailyCount))) * 100;
  const highRate = rate(high);
  const lowRate = rate(low);
  const diff = Math.round(highRate - lowRate);
  if (Math.abs(diff) < 10) return null;

  const text =
    diff > 0
      ? `You complete ${diff}% more of your habits on good-mood mornings`
      : `You complete ${-diff}% more of your habits on low-mood mornings`;
  return {
    score: Math.abs(diff) / 12,
    insight: {
      id: "mood-habits",
      text,
      strength: strengthFromPoints(Math.abs(diff)),
      detail: `${Math.round(highRate)}% done on ${high.length} good-mood days (mood ≥ 4) vs ${Math.round(lowRate)}% on ${low.length} low-mood days (mood ≤ 2).`,
    },
  };
}

/** 3. Energy vs study minutes — high-energy (>= 4) vs low-energy (<= 2) days. */
function checkEnergyVsStudy(
  days: string[],
  moodLogs: MoodLog[],
  studySessions: StudySession[],
  minDays: number
): Scored | null {
  // Per-day energy = mean across logged slots that day.
  const sums = sumByDay(moodLogs, (m) => m.log_date, (m) => m.energy);
  const counts = countByDay(moodLogs, (m) => m.log_date);
  const energyOf = (d: string): number | undefined => {
    const n = counts.get(d);
    return n ? (sums.get(d) ?? 0) / n : undefined;
  };

  const minutes = sumByDay(studySessions, (s) => s.studied_on, (s) => s.minutes);
  const high = days.filter((d) => (energyOf(d) ?? 0) >= 4);
  const low = days.filter((d) => {
    const e = energyOf(d);
    return e !== undefined && e <= 2;
  });
  if (high.length < minDays || low.length < minDays) return null;

  const highMean = mean(high.map((d) => minutes.get(d) ?? 0));
  const lowMean = mean(low.map((d) => minutes.get(d) ?? 0));
  const r = safeRatio(highMean, lowMean);
  if (!r || r.ratio < 1.3) return null;

  const where = r.aHigher ? "high-energy" : "low-energy";
  const text =
    r.ratio === Infinity
      ? `You only study on ${where} days`
      : `You study ${round1(r.ratio)}× more on ${where} days`;
  return {
    score: Math.min(r.ratio, 5) * 0.95,
    insight: {
      id: "energy-study",
      text,
      strength: strengthFromRatio(r.ratio),
      detail: `Avg ${Math.round(highMean)} min on ${high.length} high-energy days (≥ 4) vs ${Math.round(lowMean)} min on ${low.length} low-energy days (≤ 2).`,
    },
  };
}

/** 4. Study consistency — this week (pro-rated) vs the previous 4-week average. */
function checkStudyConsistency(
  studySessions: StudySession[],
  today: Date,
  minDays: number
): Scored | null {
  const weekStart = startOfWeek(today);
  const weekStartKey = ymd(weekStart);
  const todayKey = ymd(today);
  const priorStartKey = ymd(addDays(weekStart, -28));

  let current = 0;
  let prior = 0;
  const priorStudyDays = new Set<string>();
  for (const s of studySessions) {
    if (s.studied_on >= weekStartKey && s.studied_on <= todayKey) current += s.minutes;
    else if (s.studied_on >= priorStartKey && s.studied_on < weekStartKey) {
      prior += s.minutes;
      priorStudyDays.add(s.studied_on);
    }
  }
  // Guard: need a meaningful baseline — at least `minDays` distinct study days
  // in the previous 4 weeks and a non-zero average (division guard).
  if (priorStudyDays.size < minDays || prior === 0) return null;

  const priorWeekAvg = prior / 4;
  // Pro-rate the baseline to the elapsed part of the week so a Tuesday review
  // isn't always "80% below average".
  const dow = today.getDay(); // 0 = Sun
  const daysElapsed = dow === 0 ? 7 : dow;
  const expectedSoFar = priorWeekAvg * (daysElapsed / 7);
  if (expectedSoFar === 0) return null;

  const deviation = Math.round(((current - expectedSoFar) / expectedSoFar) * 100);
  if (Math.abs(deviation) < 20) return null;

  const dir = deviation > 0 ? "above" : "below";
  return {
    score: Math.abs(deviation) / 25,
    insight: {
      id: "study-consistency",
      text: `Study time is ${Math.abs(deviation)}% ${dir} your 4-week average`,
      strength: strengthFromDeviation(Math.abs(deviation)),
      detail: `${current} min so far this week vs ${Math.round(expectedSoFar)} min expected by now (4-week avg ${Math.round(priorWeekAvg)} min/week, pro-rated over ${daysElapsed} day${daysElapsed === 1 ? "" : "s"}).`,
    },
  };
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** 5. Best solve day-of-week — needs >= 10 solves and a >= 25% share. */
function checkBestSolveDay(days: string[], problems: CodingProblemRow[]): Scored | null {
  const inWindow = new Set(days);
  const perDow = new Array<number>(7).fill(0);
  let total = 0;
  for (const p of problems) {
    if (!p.solved_on || !inWindow.has(p.solved_on)) continue;
    perDow[parseYmd(p.solved_on).getDay()] += 1;
    total += 1;
  }
  if (total < 10) return null;

  let best = 0;
  for (let i = 1; i < 7; i++) if (perDow[i] > perDow[best]) best = i;
  const share = Math.round((perDow[best] / total) * 100);
  if (share < 25) return null;

  const strength: InsightStrength = share >= 40 ? "strong" : share >= 30 ? "moderate" : "weak";
  return {
    score: share / 25,
    insight: {
      id: "solve-day",
      text: `${WEEKDAY_NAMES[best]}s are your most productive solve day — ${share}% of solves`,
      strength,
      detail: `${perDow[best]} of ${total} problems in the last ${days.length} days were solved on a ${WEEKDAY_NAMES[best]}.`,
    },
  };
}

/** 6. Glucose stability vs morning energy (a rough sleep proxy). */
function checkGlucoseVsEnergy(
  days: string[],
  moodLogs: MoodLog[],
  glucose: GlucoseReading[],
  minDays: number
): Scored | null {
  const morningEnergy = new Map<string, number>();
  for (const m of moodLogs) if (m.slot === "morning") morningEnergy.set(m.log_date, m.energy);

  // Per-day in-range share (70–180 mg/dL). Days without readings are excluded.
  const totalByDay = countByDay(glucose, (g) => ymd(new Date(g.measured_at)));
  const inRangeByDay = countByDay(glucose, (g) =>
    g.value_mg_dl >= 70 && g.value_mg_dl <= 180 ? ymd(new Date(g.measured_at)) : null
  );

  const eligible = days.filter((d) => (totalByDay.get(d) ?? 0) > 0 && morningEnergy.has(d));
  const high = eligible.filter((d) => (morningEnergy.get(d) ?? 0) >= 4);
  const low = eligible.filter((d) => (morningEnergy.get(d) ?? 0) <= 2);
  if (high.length < minDays || low.length < minDays) return null;

  const inRangePct = (bucket: string[]) =>
    mean(bucket.map((d) => (inRangeByDay.get(d) ?? 0) / (totalByDay.get(d) ?? 1))) * 100;
  const highPct = inRangePct(high);
  const lowPct = inRangePct(low);
  const diff = Math.round(highPct - lowPct);
  if (Math.abs(diff) < 10) return null;

  const text =
    diff > 0
      ? `Glucose stays in range ${diff}% more often on high-energy mornings (a rough sleep proxy)`
      : `Glucose stays in range ${-diff}% more often on low-energy mornings`;
  return {
    score: Math.abs(diff) / 15,
    insight: {
      id: "glucose-energy",
      text,
      strength: strengthFromPoints(Math.abs(diff)),
      detail: `${Math.round(highPct)}% in range on ${high.length} high-energy mornings vs ${Math.round(lowPct)}% on ${low.length} low-energy mornings (70–180 mg/dL).`,
    },
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run every correlation check over the passed window and return the insights
 * that clear their thresholds, strongest first. Pure — no I/O.
 */
export function computeInsights(data: InsightsData, opts: InsightsOptions = {}): Insight[] {
  const today = opts.today ?? new Date();
  const windowDays = opts.days ?? 60;
  const minDays = opts.minBucketDays ?? 5;
  const days = dayKeys(windowDays, today);

  const results: Array<Scored | null> = [
    checkGymVsSolves(days, data.workouts, data.problems, minDays),
    checkMoodVsHabits(days, data.moodLogs, data.completions, data.activities, minDays),
    checkEnergyVsStudy(days, data.moodLogs, data.studySessions, minDays),
    checkStudyConsistency(data.studySessions, today, minDays),
    checkBestSolveDay(days, data.problems),
    checkGlucoseVsEnergy(days, data.moodLogs, data.glucose, minDays),
  ];

  return results
    .filter((r): r is Scored => r !== null)
    .sort((x, y) => y.score - x.score)
    .map((r) => r.insight);
}
