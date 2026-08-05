// Domain types matching the Supabase schema.

export type Profile = {
  user_id: string;
  display_name: string | null;
  /** How many months of time-series data to keep (1..24). Null = default 24. */
  retention_months: number | null;
  updated_at: string;
};

export type ActivityCategory =
  | "health"
  | "fitness"
  | "mind"
  | "work"
  | "self_care"
  | "other";

export type Activity = {
  id: string;
  user_id: string;
  name: string;
  icon: string | null;
  category: ActivityCategory | null;
  frequency: "daily" | "weekly" | "custom";
  /** Soft-delete flag. Archived activities keep their completion history
   *  but are hidden from the active list. May be undefined on databases
   *  where the migration hasn't been applied yet. */
  is_archived?: boolean;
  created_at: string;
};

export type ActivityCompletion = {
  id: string;
  user_id: string;
  activity_id: string;
  completed_on: string; // YYYY-MM-DD
  created_at: string;
};

export type Workout = {
  id: string;
  user_id: string;
  name: string;
  workout_type: string;
  performed_at: string; // ISO datetime
  duration_min: number | null;
  calories: number | null;
  rating: number | null;
  notes: string | null;
};

export type WorkoutExercise = {
  id: string;
  workout_id: string;
  name: string;
  sets: number | null;
  reps: number | null;
  weight: number | null;
  position: number;
};

export type PeriodLog = {
  id: string;
  user_id: string;
  log_date: string; // YYYY-MM-DD
  is_period: boolean;
  flow: "light" | "medium" | "heavy" | null;
  symptoms: string[];
  mood: string | null;
  notes: string | null;
};

export type GlucoseReading = {
  id: string;
  user_id: string;
  measured_at: string; // ISO datetime
  value_mg_dl: number;
  meal_context:
    | "fasting"
    | "before_breakfast"
    | "after_breakfast"
    | "before_lunch"
    | "after_lunch"
    | "before_dinner"
    | "after_dinner"
    | "bedtime"
    // Legacy generic values, kept for older readings.
    | "before_meal"
    | "after_meal"
    | "random"
    | null;
  meal_description: string | null;
  notes: string | null;
};

export type TodoPriority = "low" | "medium" | "high";

export type Todo = {
  id: string;
  user_id: string;
  title: string;
  is_done: boolean;
  created_at: string;
  description: string | null;
  /** ISO datetime when the ticket is due, or null for no deadline. */
  due_at: string | null;
  priority: TodoPriority;
  /** Optional effort estimate in minutes (1..1440). */
  estimated_min: number | null;
  /** Set on todos materialised from a recurrence. */
  recurrence_id?: string | null;
  /** Occurrence date (YYYY-MM-DD) for recurrence-materialised todos. */
  recurrence_due_on?: string | null;
};

// =============================================================================
// Finance / Expense Tracker
// =============================================================================

export type AccountType = "cash" | "account" | "card" | "savings" | "other";

export type FinanceAccount = {
  id: string;
  user_id: string;
  name: string;
  account_type: AccountType;
  position: number;
  archived_at: string | null;
  created_at: string;
};

export type CategoryKind = "income" | "expense";

export type FinanceCategory = {
  id: string;
  user_id: string;
  name: string;
  kind: CategoryKind;
  /** Null for top-level categories; populated for subcategories. */
  parent_id: string | null;
  position: number;
  archived_at: string | null;
  created_at: string;
};

export type TxKind = "income" | "expense" | "transfer";

export type FinanceTransaction = {
  id: string;
  user_id: string;
  kind: TxKind;
  occurred_on: string; // YYYY-MM-DD
  occurred_at: string; // ISO datetime
  /** For transfers this is the source account. */
  account_id: string;
  /** Only set when kind === 'transfer'. */
  to_account_id: string | null;
  /** Null for transfers; otherwise the (sub)category. */
  category_id: string | null;
  /** Amount in paise (₹ * 100). Always positive — sign comes from `kind`. */
  amount_paise: number;
  fees_paise: number;
  note: string | null;
  recurrence_id: string | null;
  created_at: string;
};

export type FinanceBudget = {
  id: string;
  user_id: string;
  /** Null = overall monthly budget across all categories. */
  category_id: string | null;
  month: string; // YYYY-MM-01
  amount_paise: number;
  created_at: string;
};

export type Frequency = "daily" | "weekly" | "monthly" | "yearly";

/** Stored shape of `template_json` on a recurrence row. */
export type RecurrenceTemplate = {
  kind: TxKind;
  account_id: string;
  to_account_id?: string | null;
  category_id?: string | null;
  amount_paise: number;
  fees_paise?: number;
  note?: string | null;
};

export type FinanceRecurrence = {
  id: string;
  user_id: string;
  template_json: RecurrenceTemplate;
  frequency: Frequency;
  interval_n: number;
  start_on: string; // YYYY-MM-DD
  end_on: string | null;
  last_materialised_on: string | null;
  created_at: string;
};

// =============================================================================
// Job-switch prep + day planner (2026-08)
// =============================================================================

export type Difficulty = "easy" | "medium" | "hard";
export type ProblemStatus = "todo" | "in_progress" | "solved";

/** Supabase-backed coding problem (promoted from localStorage). */
export type CodingProblemRow = {
  id: string;
  user_id: string;
  url: string;
  title: string;
  platform: string;
  difficulty: Difficulty;
  status: ProblemStatus;
  tags: string[];
  /** Target-company tags, separate from topic tags. */
  companies: string[];
  solved_on: string | null; // YYYY-MM-DD
  last_revised_on: string | null;
  revise_count: number;
  notes: string | null;
  created_at: string;
};

export type LearnPhaseStage = "learning" | "practicing" | "reviewing" | "mastered";
export type PrepTrack = "dsa" | "system_design" | "behavioral" | "project" | "other";

/** Supabase-backed learn phase; doubles as an Interview Prep Roadmap topic. */
export type LearnPhaseRow = {
  id: string;
  user_id: string;
  topic: string;
  stage: LearnPhaseStage;
  track: PrepTrack;
  started_on: string;
  target_on: string | null;
  completed_on: string | null;
  notes: string | null;
  created_at: string;
};

/** Stored shape of `template_json` on a todo recurrence row. */
export type TodoRecurrenceTemplate = {
  title: string;
  description?: string | null;
  priority: TodoPriority;
  estimated_min?: number | null;
  /** "HH:MM" local time the materialised todo is due at (default "09:00"). */
  due_time?: string;
};

export type TodoRecurrence = {
  id: string;
  user_id: string;
  template_json: TodoRecurrenceTemplate;
  frequency: Frequency;
  interval_n: number;
  start_on: string;
  end_on: string | null;
  last_materialised_on: string | null;
  created_at: string;
};

export type MoodSlot = "morning" | "evening";

export type MoodLog = {
  id: string;
  user_id: string;
  log_date: string; // YYYY-MM-DD
  slot: MoodSlot;
  mood: number; // 1..5
  energy: number; // 1..5
  note: string | null;
  created_at: string;
};

export type StudySession = {
  id: string;
  user_id: string;
  studied_on: string; // YYYY-MM-DD
  topic: string;
  minutes: number;
  notes: string | null;
  created_at: string;
};

export type ApplicationStage =
  | "wishlist"
  | "applied"
  | "oa"
  | "interview"
  | "offer"
  | "rejected";

export type JobApplication = {
  id: string;
  user_id: string;
  company: string;
  role: string;
  stage: ApplicationStage;
  jd_url: string | null;
  referral_contact: string | null;
  salary_note: string | null;
  follow_up_on: string | null; // YYYY-MM-DD
  notes: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

export type MockInterviewKind = "dsa" | "system_design" | "behavioral" | "full_loop";

export type MockInterview = {
  id: string;
  user_id: string;
  taken_on: string; // YYYY-MM-DD
  /** Company or platform (Pramp, peer, …). */
  source: string;
  kind: MockInterviewKind;
  self_rating: number; // 1..5
  questions: string | null;
  feedback: string | null;
  created_at: string;
};

export type VaultNoteKind = "star_story" | "achievement" | "resume_note" | "general";

export type VaultNote = {
  id: string;
  user_id: string;
  kind: VaultNoteKind;
  title: string;
  body: string;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type FocusSession = {
  id: string;
  user_id: string;
  started_at: string; // ISO datetime
  duration_min: number;
  todo_id: string | null;
  topic: string | null;
  created_at: string;
};

export type PlannerBlockKind = "todo" | "habit" | "study" | "gym" | "break" | "other";

export type PlannerBlock = {
  id: string;
  user_id: string;
  block_date: string; // YYYY-MM-DD
  /** Minutes from local midnight (0..1439). */
  start_min: number;
  duration_min: number;
  title: string;
  kind: PlannerBlockKind;
  ref_id: string | null;
  done: boolean;
  created_at: string;
};

export type UserSettings = {
  user_id: string;
  weekly_study_target_min: number;
  daily_solve_target: number;
  switch_target_on: string | null;
  freeze_dates: string[];
  notify_enabled: boolean;
  updated_at: string;
};

export type IntegrationProvider = "hevy" | "google_fit" | "fitbit" | "apple_health";
export type IntegrationStatus = "connected" | "pending" | "disconnected";

export type UserIntegration = {
  user_id: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  connected_at: string;
  last_sync_at: string | null;
  credentials: Record<string, unknown>;
  notes: string | null;
};
