import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  Flag,
  Map as MapIcon,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Dialog } from "@/components/ui/Dialog";
import { Badge } from "@/components/ui/Badge";
import { DateField } from "@/components/ui/DateField";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { ymd } from "@/lib/dates";
import {
  daysUntil,
  isUniqueViolation,
  shortDate,
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_PROGRESS,
  TRACK_LABELS,
  TRACK_ORDER,
} from "@/lib/prep";
import type {
  LearnPhaseRow,
  LearnPhaseStage,
  PrepTrack,
  UserSettings,
} from "@/types";
import { cn } from "@/lib/utils";

export function PrepRoadmapPage() {
  const { user } = useAuth();
  const [phases, setPhases] = useState<LearnPhaseRow[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LearnPhaseRow | null>(null);
  const [savingTarget, setSavingTarget] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [phasesRes, settingsRes] = await Promise.all([
        supabase.from("learn_phases").select("*").order("created_at"),
        supabase.from("user_settings").select("*").maybeSingle(),
      ]);
      if (cancelled) return;
      if (phasesRes.error) setError(phasesRes.error.message);
      else setPhases((phasesRes.data as LearnPhaseRow[]) ?? []);
      if (settingsRes.data) setSettings(settingsRes.data as UserSettings);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function saveSwitchTarget(next: string) {
    if (!user || savingTarget) return;
    setSavingTarget(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("user_settings")
      .upsert(
        { user_id: user.id, switch_target_on: next || null },
        { onConflict: "user_id" }
      )
      .select()
      .single();
    setSavingTarget(false);
    if (err) setError(err.message);
    else if (data) setSettings(data as UserSettings);
  }

  /** Advance/set a topic's stage optimistically; mastered fills completed_on. */
  async function setStage(phase: LearnPhaseRow, stage: LearnPhaseStage) {
    if (stage === phase.stage) return;
    const patch = {
      stage,
      completed_on:
        stage === "mastered" ? ymd() : null,
    };
    const prev = phases;
    setPhases((ps) => ps.map((p) => (p.id === phase.id ? { ...p, ...patch } : p)));
    const { error: err } = await supabase
      .from("learn_phases")
      .update(patch)
      .eq("id", phase.id);
    if (err) {
      setPhases(prev);
      setError(err.message);
    }
  }

  async function handleSave(draft: TopicDraft): Promise<boolean> {
    if (!user) return false;
    setError(null);
    if (editing) {
      const prev = phases;
      setPhases((ps) =>
        ps.map((p) => (p.id === editing.id ? { ...p, ...draft } : p))
      );
      const { data, error: err } = await supabase
        .from("learn_phases")
        .update(draft)
        .eq("id", editing.id)
        .select()
        .single();
      if (err) {
        setPhases(prev);
        if (isUniqueViolation(err)) {
          throw new Error(`You already have a topic called "${draft.topic}".`);
        }
        setError(err.message);
        return false;
      }
      if (data) {
        setPhases((ps) =>
          ps.map((p) => (p.id === (data as LearnPhaseRow).id ? (data as LearnPhaseRow) : p))
        );
      }
    } else {
      const { data, error: err } = await supabase
        .from("learn_phases")
        .insert({ user_id: user.id, ...draft })
        .select()
        .single();
      if (err) {
        if (isUniqueViolation(err)) {
          throw new Error(`You already have a topic called "${draft.topic}".`);
        }
        setError(err.message);
        return false;
      }
      if (data) setPhases((ps) => [...ps, data as LearnPhaseRow]);
    }
    setDialogOpen(false);
    setEditing(null);
    return true;
  }

  async function handleDelete(phase: LearnPhaseRow) {
    if (!confirm(`Delete topic "${phase.topic}"?`)) return;
    const prev = phases;
    setPhases((ps) => ps.filter((p) => p.id !== phase.id));
    const { error: err } = await supabase
      .from("learn_phases")
      .delete()
      .eq("id", phase.id);
    if (err) {
      setPhases(prev);
      setError(err.message);
    }
  }

  const byTrack = useMemo(() => {
    const map = new Map<PrepTrack, LearnPhaseRow[]>();
    for (const track of TRACK_ORDER) map.set(track, []);
    for (const p of phases) {
      const list = map.get(p.track) ?? map.get("other")!;
      list.push(p);
    }
    // Sort: overdue targets first, then nearest target, no-target last.
    const today = ymd();
    for (const list of map.values()) {
      list.sort((a, b) => {
        const aOver = a.target_on && a.target_on < today && a.stage !== "mastered" ? 0 : 1;
        const bOver = b.target_on && b.target_on < today && b.stage !== "mastered" ? 0 : 1;
        if (aOver !== bOver) return aOver - bOver;
        const aT = a.target_on ?? "9999-12-31";
        const bT = b.target_on ?? "9999-12-31";
        if (aT !== bT) return aT < bT ? -1 : 1;
        return a.topic.localeCompare(b.topic);
      });
    }
    return map;
  }, [phases]);

  const switchTarget = settings?.switch_target_on ?? null;
  const daysToTarget = switchTarget ? daysUntil(switchTarget) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roadmap"
        icon={<MapIcon className="h-5 w-5" />}
        description={
          phases.length === 0
            ? "Plan the topics to master before the switch."
            : `${phases.filter((p) => p.stage === "mastered").length} of ${phases.length} topics mastered.`
        }
        actions={
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }} disabled={loading}>
            <Plus className="h-4 w-4" /> Add topic
          </Button>
        }
      />

      {/* Switch-target countdown, editable inline */}
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Flag className="h-4 w-4 text-primary" />
            Switch target
          </div>
          <div className="sm:w-56">
            <DateField
              id="switch-target"
              value={switchTarget ?? ""}
              onChange={(next) => void saveSwitchTarget(next)}
              disabled={savingTarget}
              quickPicks={false}
            />
          </div>
          <div className="text-sm text-muted-foreground sm:ml-auto">
            {daysToTarget === null ? (
              "Set a date to start the countdown."
            ) : daysToTarget > 0 ? (
              <span>
                <span className="text-lg font-semibold text-primary tabular-nums">
                  {daysToTarget}
                </span>{" "}
                day{daysToTarget === 1 ? "" : "s"} to target
              </span>
            ) : daysToTarget === 0 ? (
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                Target is today
              </span>
            ) : (
              <span className="font-semibold text-rose-600 dark:text-rose-400">
                {-daysToTarget} day{daysToTarget === -1 ? "" : "s"} past target
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {loading ? (
        <SkeletonList rows={3} />
      ) : phases.length === 0 ? (
        <EmptyState
          icon={<MapIcon className="h-7 w-7" />}
          title="No topics yet"
          description="Add roadmap topics per track — DSA, system design, behavioral — and step them through to mastered."
          action={
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="h-4 w-4" /> Add topic
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {TRACK_ORDER.map((track) => {
            const list = byTrack.get(track) ?? [];
            if (list.length === 0) return null;
            const progress =
              list.reduce((sum, p) => sum + STAGE_PROGRESS[p.stage], 0) /
              list.length;
            return (
              <section key={track} className="space-y-2">
                <div className="flex items-center justify-between gap-3 px-1">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {TRACK_LABELS[track]}
                  </h3>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {list.filter((p) => p.stage === "mastered").length}/{list.length} mastered
                    · {Math.round(progress)}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <ul className="space-y-2 pt-1">
                  {list.map((p) => (
                    <TopicCard
                      key={p.id}
                      phase={p}
                      onSetStage={setStage}
                      onEdit={(ph) => {
                        setEditing(ph);
                        setDialogOpen(true);
                      }}
                      onDelete={handleDelete}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <TopicDialog
        open={dialogOpen}
        editing={editing}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />
    </div>
  );
}

// ---------- topic card ----------

function TopicCard({
  phase,
  onSetStage,
  onEdit,
  onDelete,
}: {
  phase: LearnPhaseRow;
  onSetStage: (p: LearnPhaseRow, s: LearnPhaseStage) => void;
  onEdit: (p: LearnPhaseRow) => void;
  onDelete: (p: LearnPhaseRow) => void;
}) {
  const overdue =
    !!phase.target_on && phase.target_on < ymd() && phase.stage !== "mastered";
  const mastered = phase.stage === "mastered";
  const currentIdx = STAGE_ORDER.indexOf(phase.stage);

  return (
    <li>
      <Card
        className={cn(
          "group border-l-4 transition-shadow hover:shadow-sm",
          mastered
            ? "border-l-emerald-500"
            : overdue
            ? "border-l-rose-500"
            : "border-l-primary/50"
        )}
      >
        <CardContent className="p-3 sm:p-4 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <h4
              className={cn(
                "text-sm font-medium leading-snug",
                mastered && "text-muted-foreground"
              )}
            >
              {phase.topic}
            </h4>
            <div className="flex items-center gap-1 shrink-0 -mt-1 -mr-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                aria-label={`Edit ${phase.topic}`}
                onClick={() => onEdit(phase)}
              >
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:text-destructive"
                aria-label={`Delete ${phase.topic}`}
                onClick={() => onDelete(phase)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Stage stepper */}
          <div
            className="flex items-center gap-1 flex-wrap"
            role="group"
            aria-label={`Stage for ${phase.topic}`}
          >
            {STAGE_ORDER.map((stage, i) => {
              const active = stage === phase.stage;
              const reached = i <= currentIdx;
              return (
                <button
                  key={stage}
                  type="button"
                  onClick={() => onSetStage(phase, stage)}
                  aria-pressed={active}
                  title={`Set stage to ${STAGE_LABELS[stage]}`}
                  className={cn(
                    "text-[11px] px-2.5 py-1 rounded-full border transition-all active:scale-95",
                    active
                      ? stage === "mastered"
                        ? "bg-emerald-500 text-white border-emerald-500"
                        : "bg-primary text-primary-foreground border-primary"
                      : reached
                      ? "border-primary/40 text-primary bg-primary/5 hover:bg-primary/10"
                      : "border-input text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {STAGE_LABELS[stage]}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {phase.target_on && (
              <Badge variant={overdue ? "destructive" : "info"}>
                {overdue ? (
                  <AlertCircle className="h-3 w-3" />
                ) : (
                  <CalendarClock className="h-3 w-3" />
                )}
                {overdue ? "Overdue · " : "Target "}
                {shortDate(phase.target_on)}
              </Badge>
            )}
            {phase.completed_on && (
              <Badge variant="success">Mastered {shortDate(phase.completed_on)}</Badge>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground">
              since {shortDate(phase.started_on)}
            </span>
          </div>

          {phase.notes && (
            <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">
              {phase.notes}
            </p>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

// ---------- add / edit dialog ----------

type TopicDraft = {
  topic: string;
  track: PrepTrack;
  stage: LearnPhaseStage;
  started_on: string;
  target_on: string | null;
  completed_on: string | null;
  notes: string | null;
};

function TopicDialog({
  open,
  editing,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: LearnPhaseRow | null;
  onClose: () => void;
  onSave: (draft: TopicDraft) => Promise<boolean>;
}) {
  const [topic, setTopic] = useState("");
  const [track, setTrack] = useState<PrepTrack>("dsa");
  const [stage, setStage] = useState<LearnPhaseStage>("learning");
  const [startedOn, setStartedOn] = useState(ymd());
  const [targetOn, setTargetOn] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setTopic(editing.topic);
      setTrack(editing.track);
      setStage(editing.stage);
      setStartedOn(editing.started_on);
      setTargetOn(editing.target_on ?? "");
      setNotes(editing.notes ?? "");
    } else {
      setTopic("");
      setTrack("dsa");
      setStage("learning");
      setStartedOn(ymd());
      setTargetOn("");
      setNotes("");
    }
    setErr(null);
  }, [open, editing]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed) {
      setErr("Topic is required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await onSave({
        topic: trimmed,
        track,
        stage,
        started_on: startedOn || ymd(),
        target_on: targetOn || null,
        completed_on:
          stage === "mastered"
            ? editing?.completed_on ?? ymd()
            : null,
        notes: notes.trim() ? notes.trim() : null,
      });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not save the topic.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Edit topic" : "New topic"}
      description={
        editing
          ? "Update the roadmap topic."
          : "Each topic name can only appear once on your roadmap."
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="rm-topic">Topic</Label>
          <Input
            id="rm-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Graphs — BFS/DFS patterns"
            maxLength={200}
            autoFocus
            required
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rm-track">Track</Label>
            <Select
              id="rm-track"
              value={track}
              onChange={(e) => setTrack(e.target.value as PrepTrack)}
            >
              {TRACK_ORDER.map((t) => (
                <option key={t} value={t}>
                  {TRACK_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rm-stage">Stage</Label>
            <Select
              id="rm-stage"
              value={stage}
              onChange={(e) => setStage(e.target.value as LearnPhaseStage)}
            >
              {STAGE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rm-started">Started</Label>
            <DateField
              id="rm-started"
              value={startedOn}
              onChange={setStartedOn}
              quickPicks={false}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rm-target">Target (optional)</Label>
            <DateField
              id="rm-target"
              value={targetOn}
              onChange={setTargetOn}
              quickPicks={false}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rm-notes">Notes (optional)</Label>
          <Textarea
            id="rm-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Resources, problem lists, weak spots…"
            maxLength={2000}
            rows={3}
          />
        </div>

        {err && (
          <p role="alert" className="text-sm text-destructive">
            {err}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !topic.trim()}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add topic"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
