import { useEffect, useRef, useState } from "react";
import { Zap, Check, Sunrise, Moon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { ymd } from "@/lib/dates";
import type { MoodLog, MoodSlot } from "@/types";
import { cn } from "@/lib/utils";

// 1..5 — index i renders value i + 1.
const MOOD_EMOJI = ["😞", "😕", "😐", "🙂", "😄"] as const;
const MOOD_LABELS = ["Awful", "Low", "Okay", "Good", "Great"] as const;

type SlotDraft = { mood: number; energy: number; note: string };
type SaveState = "idle" | "saving" | "saved" | "error";

type SlotQueue = { pending: SlotDraft | null; running: boolean };

/**
 * Compact 1-tap mood + energy check-in for TODAY's morning and evening slots.
 * Self-contained (fetches its own data); saves via UPSERT on
 * (user_id, log_date, slot) so re-tapping updates instead of erroring.
 * No layout assumptions beyond width:100% — safe in any dashboard column.
 */
export function MoodCheckIn() {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState<Partial<Record<MoodSlot, SlotDraft>>>({});
  const [saveState, setSaveState] = useState<Record<MoodSlot, SaveState>>({
    morning: "idle",
    evening: "idle",
  });
  const [loading, setLoading] = useState(true);

  // Per-slot serialized save queue: only one upsert in flight per slot, and
  // rapid taps collapse into the latest payload (double-submit guard).
  const queueRef = useRef<Record<MoodSlot, SlotQueue>>({
    morning: { pending: null, running: false },
    evening: { pending: null, running: false },
  });
  const noteTimerRef = useRef<Record<MoodSlot, number | null>>({
    morning: null,
    evening: null,
  });
  const savedTimerRef = useRef<Record<MoodSlot, number | null>>({
    morning: null,
    evening: null,
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const slot of ["morning", "evening"] as const) {
        const nt = noteTimerRef.current[slot];
        if (nt !== null) window.clearTimeout(nt);
        const st = savedTimerRef.current[slot];
        if (st !== null) window.clearTimeout(st);
      }
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("mood_logs")
        .select("*")
        .eq("log_date", ymd());
      if (cancelled) return;
      const next: Partial<Record<MoodSlot, SlotDraft>> = {};
      for (const row of (data ?? []) as MoodLog[]) {
        next[row.slot] = { mood: row.mood, energy: row.energy, note: row.note ?? "" };
      }
      setDrafts(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  function setSlotSaveState(slot: MoodSlot, s: SaveState) {
    if (!mountedRef.current) return;
    setSaveState((prev) => ({ ...prev, [slot]: s }));
    if (s === "saved") {
      const prevTimer = savedTimerRef.current[slot];
      if (prevTimer !== null) window.clearTimeout(prevTimer);
      savedTimerRef.current[slot] = window.setTimeout(() => {
        if (mountedRef.current) {
          setSaveState((prev) =>
            prev[slot] === "saved" ? { ...prev, [slot]: "idle" } : prev
          );
        }
      }, 2000);
    }
  }

  function enqueue(slot: MoodSlot, draft: SlotDraft) {
    if (!user) return;
    const userId = user.id;
    const q = queueRef.current[slot];
    q.pending = draft;
    if (q.running) return;
    q.running = true;
    void (async () => {
      try {
        while (q.pending) {
          const payload = q.pending;
          q.pending = null;
          setSlotSaveState(slot, "saving");
          const { error } = await supabase.from("mood_logs").upsert(
            {
              user_id: userId,
              log_date: ymd(),
              slot,
              mood: payload.mood,
              energy: payload.energy,
              note: payload.note.trim() ? payload.note.trim() : null,
            },
            { onConflict: "user_id,log_date,slot" }
          );
          setSlotSaveState(slot, error ? "error" : "saved");
        }
      } finally {
        q.running = false;
      }
    })();
  }

  function tapMood(slot: MoodSlot, mood: number) {
    const prev = drafts[slot];
    const next: SlotDraft = {
      mood,
      energy: prev?.energy ?? 3,
      note: prev?.note ?? "",
    };
    setDrafts((d) => ({ ...d, [slot]: next }));
    enqueue(slot, next);
  }

  function tapEnergy(slot: MoodSlot, energy: number) {
    const prev = drafts[slot];
    const next: SlotDraft = {
      mood: prev?.mood ?? 3,
      energy,
      note: prev?.note ?? "",
    };
    setDrafts((d) => ({ ...d, [slot]: next }));
    enqueue(slot, next);
  }

  function changeNote(slot: MoodSlot, note: string) {
    const prev = drafts[slot];
    if (!prev) return; // note only appears after the first tap
    const next: SlotDraft = { ...prev, note };
    setDrafts((d) => ({ ...d, [slot]: next }));
    const t = noteTimerRef.current[slot];
    if (t !== null) window.clearTimeout(t);
    noteTimerRef.current[slot] = window.setTimeout(() => enqueue(slot, next), 600);
  }

  const activeSlot: MoodSlot = new Date().getHours() < 15 ? "morning" : "evening";

  return (
    <Card className="w-full">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Mood check-in</h3>
          <span className="text-[11px] text-muted-foreground">Today</span>
        </div>
        <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-2", loading && "opacity-60")}>
          {(["morning", "evening"] as const).map((slot) => (
            <SlotPanel
              key={slot}
              slot={slot}
              draft={drafts[slot]}
              active={slot === activeSlot}
              saveState={saveState[slot]}
              disabled={loading || !user}
              onMood={(v) => tapMood(slot, v)}
              onEnergy={(v) => tapEnergy(slot, v)}
              onNote={(v) => changeNote(slot, v)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function SlotPanel({
  slot,
  draft,
  active,
  saveState,
  disabled,
  onMood,
  onEnergy,
  onNote,
}: {
  slot: MoodSlot;
  draft: SlotDraft | undefined;
  active: boolean;
  saveState: SaveState;
  disabled: boolean;
  onMood: (v: number) => void;
  onEnergy: (v: number) => void;
  onNote: (v: string) => void;
}) {
  const label = slot === "morning" ? "Morning" : "Evening";
  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 space-y-2 transition-colors",
        active ? "border-primary/50 bg-primary/5" : "border-border"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium",
            active ? "text-primary" : "text-muted-foreground"
          )}
        >
          {slot === "morning" ? (
            <Sunrise className="h-3.5 w-3.5" />
          ) : (
            <Moon className="h-3.5 w-3.5" />
          )}
          {label}
        </span>
        <span className="text-[10px] leading-none" aria-live="polite">
          {saveState === "saving" && <span className="text-muted-foreground">Saving…</span>}
          {saveState === "saved" && (
            <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
              <Check className="h-3 w-3" /> Saved
            </span>
          )}
          {saveState === "error" && <span className="text-destructive">Retry a tap</span>}
        </span>
      </div>

      {/* Mood emoji 1..5 */}
      <div className="flex items-center justify-between" role="radiogroup" aria-label={`${label} mood`}>
        {MOOD_EMOJI.map((emoji, i) => {
          const value = i + 1;
          const selected = draft?.mood === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${label} mood: ${MOOD_LABELS[i]}`}
              title={MOOD_LABELS[i]}
              disabled={disabled}
              onClick={() => onMood(value)}
              className={cn(
                "h-8 w-8 rounded-full text-lg leading-none inline-flex items-center justify-center",
                "transition-all active:scale-90 disabled:pointer-events-none disabled:opacity-50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "bg-primary/15 ring-1 ring-primary/40 scale-110"
                  : draft
                  ? "opacity-40 hover:opacity-100 grayscale hover:grayscale-0"
                  : "opacity-70 hover:opacity-100"
              )}
            >
              {emoji}
            </button>
          );
        })}
      </div>

      {/* Energy bolts 1..5 */}
      <div className="flex items-center justify-between" role="radiogroup" aria-label={`${label} energy`}>
        {[1, 2, 3, 4, 5].map((value) => {
          const filled = draft != null && value <= draft.energy;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={draft?.energy === value}
              aria-label={`${label} energy: ${value} of 5`}
              disabled={disabled}
              onClick={() => onEnergy(value)}
              className={cn(
                "h-7 w-8 rounded-md inline-flex items-center justify-center",
                "transition-all active:scale-90 disabled:pointer-events-none disabled:opacity-50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filled
                  ? "text-amber-500"
                  : "text-muted-foreground/40 hover:text-muted-foreground"
              )}
            >
              <Zap className={cn("h-4 w-4", filled && "fill-current")} />
            </button>
          );
        })}
      </div>

      {/* Note appears after first tap; auto-saves (debounced) */}
      {draft && (
        <input
          type="text"
          value={draft.note}
          onChange={(e) => onNote(e.target.value)}
          placeholder="Add a note…"
          maxLength={200}
          aria-label={`${label} note`}
          className={cn(
            "w-full h-7 rounded-md border border-input bg-background px-2 text-xs",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
        />
      )}
    </div>
  );
}
