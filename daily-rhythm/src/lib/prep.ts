// Shared helpers for the Job Prep hub pages (roadmap, applications,
// interviews, study, vault). Keep cross-page constants and small pure
// functions here so the five pages stay consistent.

import { parseYmd, ymd } from "@/lib/dates";
import type {
  ApplicationStage,
  LearnPhaseStage,
  MockInterviewKind,
  PrepTrack,
  VaultNoteKind,
} from "@/types";

// ----------------------------------------------------------------------------
// Error helpers
// ----------------------------------------------------------------------------

/** True when a Supabase/Postgres error is a unique-constraint violation. */
export function isUniqueViolation(
  error: { code?: string; message?: string } | null
): boolean {
  if (!error) return false;
  return (
    error.code === "23505" ||
    /duplicate key value/i.test(error.message ?? "")
  );
}

// ----------------------------------------------------------------------------
// Labels & orderings
// ----------------------------------------------------------------------------

export const TRACK_ORDER: PrepTrack[] = [
  "dsa",
  "system_design",
  "behavioral",
  "project",
  "other",
];

export const TRACK_LABELS: Record<PrepTrack, string> = {
  dsa: "DSA",
  system_design: "System Design",
  behavioral: "Behavioral",
  project: "Project",
  other: "Other",
};

export const STAGE_ORDER: LearnPhaseStage[] = [
  "learning",
  "practicing",
  "reviewing",
  "mastered",
];

export const STAGE_LABELS: Record<LearnPhaseStage, string> = {
  learning: "Learning",
  practicing: "Practicing",
  reviewing: "Reviewing",
  mastered: "Mastered",
};

/** Stage → progress percentage used for per-track progress bars. */
export const STAGE_PROGRESS: Record<LearnPhaseStage, number> = {
  learning: 25,
  practicing: 50,
  reviewing: 75,
  mastered: 100,
};

export const APP_STAGE_ORDER: ApplicationStage[] = [
  "wishlist",
  "applied",
  "oa",
  "interview",
  "offer",
  "rejected",
];

export const APP_STAGE_LABELS: Record<ApplicationStage, string> = {
  wishlist: "Wishlist",
  applied: "Applied",
  oa: "OA",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

export const INTERVIEW_KIND_ORDER: MockInterviewKind[] = [
  "dsa",
  "system_design",
  "behavioral",
  "full_loop",
];

export const INTERVIEW_KIND_LABELS: Record<MockInterviewKind, string> = {
  dsa: "DSA",
  system_design: "System Design",
  behavioral: "Behavioral",
  full_loop: "Full Loop",
};

export const VAULT_KIND_ORDER: VaultNoteKind[] = [
  "star_story",
  "achievement",
  "resume_note",
  "general",
];

export const VAULT_KIND_LABELS: Record<VaultNoteKind, string> = {
  star_story: "STAR Story",
  achievement: "Achievement",
  resume_note: "Resume Note",
  general: "General",
};

// ----------------------------------------------------------------------------
// Chart palette — mirrors src/lib/finance.ts PIE_COLORS for visual consistency
// ----------------------------------------------------------------------------

export const PREP_CHART_COLORS = {
  primary: "#f97066", // coral (app primary accent)
  blue: "#5fb3e8",
  green: "#7dd3a6",
  yellow: "#fdd663",
  violet: "#a78bfa",
  slate: "#94a3b8",
} as const;

export const TOPIC_BAR_COLORS = [
  "#f97066",
  "#f6a868",
  "#fdd663",
  "#7dd3a6",
  "#5fb3e8",
];

// ----------------------------------------------------------------------------
// Date / formatting helpers
// ----------------------------------------------------------------------------

/** Whole days from today (local) until a YYYY-MM-DD date. Negative = past. */
export function daysUntil(dateStr: string): number {
  const target = parseYmd(dateStr).getTime();
  const today = parseYmd(ymd()).getTime();
  return Math.round((target - today) / 86_400_000);
}

/** "45m", "2h", "2h 30m" */
export function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "Aug 3" style label from YYYY-MM-DD. */
export function shortDate(dateStr: string): string {
  return parseYmd(dateStr).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

// ----------------------------------------------------------------------------
// STAR story serialisation (vault)
// ----------------------------------------------------------------------------

export type StarSections = {
  situation: string;
  task: string;
  action: string;
  result: string;
};

export const EMPTY_STAR: StarSections = {
  situation: "",
  task: "",
  action: "",
  result: "",
};

/** Serialise the four STAR sections into a markdown body. */
export function serializeStar(s: StarSections): string {
  return [
    "## Situation",
    s.situation.trim(),
    "",
    "## Task",
    s.task.trim(),
    "",
    "## Action",
    s.action.trim(),
    "",
    "## Result",
    s.result.trim(),
  ].join("\n");
}

/**
 * Parse a markdown body back into STAR sections. Content before the first
 * heading (or a body with no headings) lands in `situation` so nothing is
 * silently lost when editing.
 */
export function parseStar(body: string): StarSections {
  const out: StarSections = { ...EMPTY_STAR };
  const re = /^##\s*(Situation|Task|Action|Result)\s*$/gim;
  type Hit = { key: keyof StarSections; start: number; contentStart: number };
  const hits: Hit[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    hits.push({
      key: m[1].toLowerCase() as keyof StarSections,
      start: m.index,
      contentStart: m.index + m[0].length,
    });
  }
  if (hits.length === 0) {
    out.situation = body.trim();
    return out;
  }
  const preamble = body.slice(0, hits[0].start).trim();
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].start : body.length;
    const text = body.slice(hits[i].contentStart, end).trim();
    // Last heading wins if a section repeats; simple and predictable.
    out[hits[i].key] = text;
  }
  if (preamble) {
    out.situation = out.situation ? `${preamble}\n${out.situation}` : preamble;
  }
  return out;
}
