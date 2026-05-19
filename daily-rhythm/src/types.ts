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
