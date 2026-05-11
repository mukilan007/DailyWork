// Domain types matching the Supabase schema.

export type Profile = {
  user_id: string;
  display_name: string | null;
  /** How many months of time-series data to keep (1..24). Null = default 24. */
  retention_months: number | null;
  updated_at: string;
};

export type ActivityCategory = "health" | "fitness" | "mind" | "work" | "self_care";

export type Activity = {
  id: string;
  user_id: string;
  name: string;
  icon: string | null;
  category: ActivityCategory | null;
  frequency: "daily" | "weekly" | "custom";
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
