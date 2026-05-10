// Domain types matching the Supabase schema.

export type Profile = {
  user_id: string;
  display_name: string | null;
  updated_at: string;
};

export type Activity = {
  id: string;
  user_id: string;
  name: string;
  icon: string | null;
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
  meal_context: "fasting" | "before_meal" | "after_meal" | "bedtime" | "random" | null;
  notes: string | null;
};
