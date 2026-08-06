import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Briefcase,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Flame,
  Plus,
  RotateCcw,
  Snowflake,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Dialog } from "@/components/ui/Dialog";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import type { PlannerBlock, PlannerBlockKind, Todo, Workout } from "@/types";
import { addDays, formatLongDate, parseYmd, ymd } from "@/lib/dates";
import {
  AgendaFetchResult,
  FREEZES_PER_MONTH,
  PLAN_WINDOW_END,
  PLAN_WINDOW_START,
  PlanCandidate,
  fetchAgendaData,
  findNextFreeStart,
  markRevised,
  planDay,
  useFreeze,
} from "@/lib/agenda";
import { cn } from "@/lib/utils";

// Timeline window: 06:00–23:00.
const DAY_START_MIN = 6 * 60;
const DAY_END_MIN = 23 * 60;
const HOUR_PX = 56;
const TIMELINE_HOURS = Array.from({ length: (DAY_END_MIN - DAY_START_MIN) / 60 }, (_, i) => 6 + i);
const TIMELINE_PX = TIMELINE_HOURS.length * HOUR_PX;

const KIND_OPTIONS: { value: PlannerBlockKind; label: string }[] = [
  { value: "todo", label: "Todo" },
  { value: "habit", label: "Habit" },
  { value: "study", label: "Study" },
  { value: "gym", label: "Gym" },
  { value: "break", label: "Break" },
  { value: "other", label: "Other" },
];

const KIND_STYLES: Record<PlannerBlockKind, string> = {
  todo: "bg-sky-500/15 border-sky-500/40 text-sky-700 dark:text-sky-300",
  habit: "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  study: "bg-indigo-500/15 border-indigo-500/40 text-indigo-700 dark:text-indigo-300",
  gym: "bg-orange-500/15 border-orange-500/40 text-orange-700 dark:text-orange-300",
  break: "bg-slate-500/15 border-slate-500/40 text-slate-700 dark:text-slate-300",
  other: "bg-violet-500/15 border-violet-500/40 text-violet-700 dark:text-violet-300",
};

const DUPLICATE_BLOCK_MESSAGE =
  "You already have a block with that title at that exact time — tweak the title or start time.";

function isUniqueViolation(error: { code?: string | null } | null): boolean {
  return error?.code === "23505";
}

function minToTimeInput(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeInputToMin(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const min = Number(match[1]) * 60 + Number(match[2]);
  return min >= 0 && min <= 1439 ? min : null;
}

function formatMin(min: number): string {
  const d = new Date();
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Minutes from local midnight for an ISO datetime. */
function isoToMin(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function sortBlocks(blocks: PlannerBlock[]): PlannerBlock[] {
  return blocks.slice().sort((a, b) => a.start_min - b.start_min || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function TodayPage() {
  const { user } = useAuth();
  const todayYmd = ymd();
  const [dateYmd, setDateYmd] = useState(todayYmd);
  const viewingToday = dateYmd === todayYmd;

  const [blocks, setBlocks] = useState<PlannerBlock[]>([]);
  const [dayTodos, setDayTodos] = useState<Todo[]>([]);
  const [dayWorkouts, setDayWorkouts] = useState<Workout[]>([]);
  const [dayLoading, setDayLoading] = useState(true);
  const [agendaBundle, setAgendaBundle] = useState<AgendaFetchResult | null>(null);
  const [agendaVersion, setAgendaVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Block dialog state.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState<PlannerBlock | null>(null);
  const [prefillStartMin, setPrefillStartMin] = useState<number>(9 * 60);

  // Double-submit guards for one-click agenda actions.
  const pendingActions = useRef(new Set<string>());
  const [planning, setPlanning] = useState(false);
  const [freezing, setFreezing] = useState(false);

  // --- Day-scoped data (timeline) --------------------------------------
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setDayLoading(true);
      const dayStart = parseYmd(dateYmd);
      const dayStartIso = dayStart.toISOString();
      const dayEndIso = addDays(dayStart, 1).toISOString();
      const [blocksRes, todosRes, workoutsRes] = await Promise.all([
        supabase
          .from("planner_blocks")
          .select("*")
          .eq("block_date", dateYmd)
          .order("start_min", { ascending: true }),
        supabase
          .from("todos")
          .select("id,user_id,title,is_done,created_at,description,due_at,priority,estimated_min")
          .not("due_at", "is", null)
          .gte("due_at", dayStartIso)
          .lt("due_at", dayEndIso),
        supabase
          .from("workouts")
          .select("id,user_id,name,workout_type,performed_at,duration_min,calories,rating,notes")
          .gte("performed_at", dayStartIso)
          .lt("performed_at", dayEndIso),
      ]);
      if (cancelled) return;
      const firstError = blocksRes.error ?? todosRes.error ?? workoutsRes.error;
      if (firstError) {
        setError(firstError.message);
      } else {
        setError(null);
        setBlocks(sortBlocks((blocksRes.data ?? []) as PlannerBlock[]));
        setDayTodos((todosRes.data ?? []) as Todo[]);
        setDayWorkouts((workoutsRes.data ?? []) as Workout[]);
      }
      setDayLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, dateYmd]);

  // --- Agenda data (always for the real today) --------------------------
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const result = await fetchAgendaData(supabase, user.id);
      if (cancelled) return;
      if (result.error) setError(result.error);
      setAgendaBundle(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, agendaVersion]);

  const agenda = agendaBundle?.agenda ?? null;

  /** Agenda items already represented on today's timeline. */
  const scheduledKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const b of blocks) {
      if (b.ref_id) keys.add(b.ref_id);
      keys.add(b.title);
    }
    return keys;
  }, [blocks]);

  // --- Block CRUD --------------------------------------------------------
  async function saveBlock(draft: BlockDraft): Promise<string | null> {
    if (!user) return null;
    if (editingBlock) {
      const { data, error: err } = await supabase
        .from("planner_blocks")
        .update({
          title: draft.title,
          kind: draft.kind,
          start_min: draft.start_min,
          duration_min: draft.duration_min,
          done: draft.done,
        })
        .eq("id", editingBlock.id)
        .select()
        .single();
      if (err) return isUniqueViolation(err) ? DUPLICATE_BLOCK_MESSAGE : err.message;
      if (data) {
        setBlocks((prev) => sortBlocks(prev.map((b) => (b.id === data.id ? data : b))));
      }
    } else {
      const { data, error: err } = await supabase
        .from("planner_blocks")
        .insert({
          user_id: user.id,
          block_date: dateYmd,
          start_min: draft.start_min,
          duration_min: draft.duration_min,
          title: draft.title,
          kind: draft.kind,
          done: draft.done,
        })
        .select()
        .single();
      if (err) return isUniqueViolation(err) ? DUPLICATE_BLOCK_MESSAGE : err.message;
      if (data) setBlocks((prev) => sortBlocks([...prev, data]));
    }
    setDialogOpen(false);
    setEditingBlock(null);
    return null;
  }

  async function deleteBlock(block: PlannerBlock): Promise<string | null> {
    const prev = blocks;
    setBlocks((bs) => bs.filter((b) => b.id !== block.id));
    const { error: err } = await supabase.from("planner_blocks").delete().eq("id", block.id);
    if (err) {
      setBlocks(prev);
      return err.message;
    }
    setDialogOpen(false);
    setEditingBlock(null);
    return null;
  }

  function openAdd(startMin: number) {
    setEditingBlock(null);
    setPrefillStartMin(startMin);
    setDialogOpen(true);
  }

  function openEdit(block: PlannerBlock) {
    setEditingBlock(block);
    setDialogOpen(true);
  }

  // --- Agenda actions ----------------------------------------------------
  /** Insert one agenda item into the next free hour of today's timeline. */
  async function scheduleItem(item: PlanCandidate) {
    if (!user || !viewingToday) return;
    const key = item.ref_id ?? item.title;
    if (pendingActions.current.has(key)) return;
    pendingActions.current.add(key);
    try {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      // Prefer the next free hour from now; fall back to any free slot today.
      const start =
        findNextFreeStart(blocks, item.duration_min, Math.max(DAY_START_MIN, nowMin), DAY_END_MIN) ??
        findNextFreeStart(blocks, item.duration_min, DAY_START_MIN, DAY_END_MIN);
      if (start === null) {
        setError("No free slot left on today's timeline (06:00–23:00).");
        return;
      }
      const { data, error: err } = await supabase
        .from("planner_blocks")
        .insert({
          user_id: user.id,
          block_date: dateYmd,
          start_min: start,
          duration_min: item.duration_min,
          title: item.title,
          kind: item.kind,
          ref_id: item.ref_id,
        })
        .select()
        .single();
      if (err) {
        setError(isUniqueViolation(err) ? DUPLICATE_BLOCK_MESSAGE : err.message);
      } else if (data) {
        setError(null);
        setBlocks((prev) => sortBlocks([...prev, data]));
      }
    } finally {
      pendingActions.current.delete(key);
    }
  }

  /** Auto-schedule up to 5 unscheduled agenda items into 09:00–21:00. */
  async function planMyDay() {
    if (!user || !viewingToday || planning || !agenda) return;
    setPlanning(true);
    try {
      const candidates = buildCandidates(agenda).filter(
        (c) => !(c.ref_id && scheduledKeys.has(c.ref_id)) && !scheduledKeys.has(c.title)
      );
      const placed = planDay(candidates, blocks, 5, PLAN_WINDOW_START, PLAN_WINDOW_END);
      if (placed.length === 0) {
        setError("Nothing left to plan — everything is either scheduled or there's no free slot.");
        return;
      }
      const rows = placed.map((p) => ({
        user_id: user.id,
        block_date: dateYmd,
        start_min: p.start_min,
        duration_min: p.duration_min,
        title: p.title,
        kind: p.kind,
        ref_id: p.ref_id,
      }));
      // One batch upsert; the unique (user_id, block_date, start_min, title)
      // index absorbs any race with ignoreDuplicates.
      const { data, error: err } = await supabase
        .from("planner_blocks")
        .upsert(rows, {
          onConflict: "user_id,block_date,start_min,title",
          ignoreDuplicates: true,
        })
        .select();
      if (err) {
        setError(err.message);
      } else {
        setError(null);
        if (data && data.length > 0) {
          setBlocks((prev) => {
            const known = new Set(prev.map((b) => b.id));
            return sortBlocks([...prev, ...data.filter((b: PlannerBlock) => !known.has(b.id))]);
          });
        }
      }
    } finally {
      setPlanning(false);
    }
  }

  async function handleMarkRevised(problemId: string, reviseCount: number) {
    if (pendingActions.current.has(problemId)) return;
    pendingActions.current.add(problemId);
    try {
      const { error: err } = await markRevised(supabase, { id: problemId, revise_count: reviseCount });
      if (err) setError(err);
      else {
        setError(null);
        setAgendaVersion((v) => v + 1);
      }
    } finally {
      pendingActions.current.delete(problemId);
    }
  }

  async function handleFreezeYesterday() {
    if (!user || !agendaBundle || freezing) return;
    setFreezing(true);
    try {
      const yesterday = ymd(addDays(parseYmd(todayYmd), -1));
      const { error: err } = await useFreeze(
        supabase,
        user.id,
        agendaBundle.inputs.settings,
        yesterday
      );
      if (err) setError(err);
      else {
        setError(null);
        setAgendaVersion((v) => v + 1);
      }
    } finally {
      setFreezing(false);
    }
  }

  const dateLabel = formatLongDate(parseYmd(dateYmd));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Day Planner"
        icon={<CalendarDays className="h-5 w-5" />}
        description={viewingToday ? `Today — ${dateLabel}` : dateLabel}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous day"
              className="h-8 w-8"
              onClick={() => setDateYmd(ymd(addDays(parseYmd(dateYmd), -1)))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={viewingToday}
              onClick={() => setDateYmd(todayYmd)}
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next day"
              className="h-8 w-8"
              onClick={() => setDateYmd(ymd(addDays(parseYmd(dateYmd), 1)))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button onClick={() => openAdd(9 * 60)} disabled={dayLoading}>
              <Plus className="h-4 w-4" /> Add block
            </Button>
          </div>
        }
      />

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] items-start">
        {/* Timeline */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Timeline</CardTitle>
              <CardDescription>
                06:00–23:00 · click an empty slot to add a block
              </CardDescription>
            </div>
            {viewingToday && (
              <Button
                variant="outline"
                size="sm"
                onClick={planMyDay}
                disabled={planning || dayLoading || !agenda}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {planning ? "Planning…" : "Plan my day"}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {dayLoading ? (
              <SkeletonCard rows={6} />
            ) : (
              <Timeline
                blocks={blocks}
                todos={dayTodos}
                workouts={dayWorkouts}
                showNow={viewingToday}
                onSlotClick={openAdd}
                onBlockClick={openEdit}
              />
            )}
          </CardContent>
        </Card>

        {/* Agenda panel */}
        <div className="space-y-4">
          {agenda && (
            <SolveGoalCard
              agenda={agenda}
              freezing={freezing}
              onFreeze={handleFreezeYesterday}
            />
          )}
          <Card>
            <CardHeader>
              <CardTitle>Agenda</CardTitle>
              <CardDescription>
                {viewingToday
                  ? "What's due today — schedule items onto the timeline."
                  : "Agenda is always for today — switch back to today to schedule."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {!agenda ? (
                <SkeletonCard rows={5} />
              ) : (
                <>
                  <AgendaSection
                    label="Overdue"
                    icon={<AlertCircle className="h-3.5 w-3.5 text-rose-500" />}
                    empty="Nothing overdue."
                    items={agenda.overdueTodos.map((t) => ({
                      key: t.id,
                      title: t.title,
                      hint: t.due_at ? `due ${formatDue(t.due_at)}` : undefined,
                      candidate: todoCandidate(t),
                    }))}
                    scheduledKeys={scheduledKeys}
                    canSchedule={viewingToday}
                    onSchedule={scheduleItem}
                  />
                  <AgendaSection
                    label="Today"
                    icon={<CalendarClock className="h-3.5 w-3.5 text-amber-500" />}
                    empty="No tickets due today."
                    items={agenda.todayTodos.map((t) => ({
                      key: t.id,
                      title: t.title,
                      hint: t.due_at ? formatMin(isoToMin(t.due_at)) : undefined,
                      candidate: todoCandidate(t),
                    }))}
                    scheduledKeys={scheduledKeys}
                    canSchedule={viewingToday}
                    onSchedule={scheduleItem}
                  />
                  <AgendaSection
                    label="Habits"
                    icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                    empty="All habits done."
                    items={agenda.habitsDue.map((a) => ({
                      key: a.id,
                      title: `${a.icon ? `${a.icon} ` : ""}${a.name}`,
                      hint: a.frequency,
                      candidate: {
                        title: a.name,
                        kind: "habit" as const,
                        ref_id: a.id,
                        duration_min: 60,
                      },
                    }))}
                    scheduledKeys={scheduledKeys}
                    canSchedule={viewingToday}
                    onSchedule={scheduleItem}
                  />
                  <AgendaSection
                    label="Revise"
                    icon={<RotateCcw className="h-3.5 w-3.5 text-indigo-500" />}
                    empty="No revisions due — spaced repetition is happy."
                    items={agenda.revisions.map((p) => ({
                      key: p.id,
                      title: p.title,
                      hint: `solved ${p.solved_on} · pass ${p.revise_count + 1}/3`,
                      candidate: {
                        title: `Revise: ${p.title}`,
                        kind: "study" as const,
                        ref_id: p.id,
                        duration_min: 60,
                      },
                      extraAction: {
                        label: "Mark revised",
                        onClick: () => handleMarkRevised(p.id, p.revise_count),
                      },
                    }))}
                    scheduledKeys={scheduledKeys}
                    canSchedule={viewingToday}
                    onSchedule={scheduleItem}
                  />
                  <AgendaSection
                    label="Follow-ups"
                    icon={<Briefcase className="h-3.5 w-3.5 text-sky-500" />}
                    empty="No application follow-ups due."
                    items={agenda.followUpsDue.map((j) => ({
                      key: j.id,
                      title: `${j.company} — ${j.role}`,
                      hint: `${j.stage} · follow up ${j.follow_up_on}`,
                      candidate: {
                        title: `Follow up: ${j.company}`,
                        kind: "other" as const,
                        ref_id: j.id,
                        duration_min: 60,
                      },
                    }))}
                    scheduledKeys={scheduledKeys}
                    canSchedule={viewingToday}
                    onSchedule={scheduleItem}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <BlockDialog
        open={dialogOpen}
        editing={editingBlock}
        defaultStartMin={prefillStartMin}
        onClose={() => {
          setDialogOpen(false);
          setEditingBlock(null);
        }}
        onSave={saveBlock}
        onDelete={deleteBlock}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Candidate builders (priority: overdue → today → revisions → habits)
// ---------------------------------------------------------------------------

function todoCandidate(t: Todo): PlanCandidate {
  return { title: t.title, kind: "todo", ref_id: t.id, duration_min: t.estimated_min ?? 60 };
}

function buildCandidates(agenda: NonNullable<AgendaFetchResult["agenda"]>): PlanCandidate[] {
  return [
    ...agenda.overdueTodos.map(todoCandidate),
    ...agenda.todayTodos.map(todoCandidate),
    ...agenda.revisions.map((p) => ({
      title: `Revise: ${p.title}`,
      kind: "study" as const,
      ref_id: p.id,
      duration_min: 60,
    })),
    ...agenda.habitsDue.map((a) => ({
      title: a.name,
      kind: "habit" as const,
      ref_id: a.id,
      duration_min: 60,
    })),
  ];
}

function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Solve goal + streak card
// ---------------------------------------------------------------------------

function SolveGoalCard({
  agenda,
  freezing,
  onFreeze,
}: {
  agenda: NonNullable<AgendaFetchResult["agenda"]>;
  freezing: boolean;
  onFreeze: () => void;
}) {
  const { solveGoal, streak, canFreezeYesterday, freezesUsedThisMonth } = agenda;
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Solve goal
            </p>
            <p className="mt-1 text-lg font-semibold tracking-tight">
              {solveGoal.solvedToday}/{solveGoal.target} solved today
            </p>
          </div>
          <div
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold",
              streak > 0
                ? "bg-orange-500/10 text-orange-600 dark:text-orange-400 ring-1 ring-orange-500/20"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Flame className="h-4 w-4" />
            <span className="tabular-nums">{streak}</span>
            <span className="text-[10px] font-normal opacity-80">
              {streak === 1 ? "day" : "days"}
            </span>
          </div>
        </div>
        {solveGoal.met ? (
          <Badge variant="success">Goal met — keep the flame alive</Badge>
        ) : (
          <Badge variant="warning">
            {solveGoal.target - solveGoal.solvedToday} more to hit today&rsquo;s goal
          </Badge>
        )}
        {canFreezeYesterday && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 p-2.5">
            <p className="text-xs text-muted-foreground">
              Yesterday broke your streak — freeze it?{" "}
              <span className="tabular-nums">
                ({FREEZES_PER_MONTH - freezesUsedThisMonth} freeze
                {FREEZES_PER_MONTH - freezesUsedThisMonth === 1 ? "" : "s"} left this month)
              </span>
            </p>
            <Button variant="outline" size="sm" onClick={onFreeze} disabled={freezing}>
              <Snowflake className="h-3.5 w-3.5 text-sky-500" />
              {freezing ? "Freezing…" : "Freeze"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Agenda section
// ---------------------------------------------------------------------------

interface AgendaItemView {
  key: string;
  title: string;
  hint?: string;
  candidate: PlanCandidate;
  extraAction?: { label: string; onClick: () => void };
}

function AgendaSection({
  label,
  icon,
  empty,
  items,
  scheduledKeys,
  canSchedule,
  onSchedule,
}: {
  label: string;
  icon: React.ReactNode;
  empty: string;
  items: AgendaItemView[];
  scheduledKeys: ReadonlySet<string>;
  canSchedule: boolean;
  onSchedule: (c: PlanCandidate) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </h3>
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => {
            const scheduled =
              (item.candidate.ref_id !== null && scheduledKeys.has(item.candidate.ref_id)) ||
              scheduledKeys.has(item.candidate.title);
            return (
              <li
                key={item.key}
                className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{item.title}</p>
                  {item.hint && (
                    <p className="text-[11px] text-muted-foreground truncate">{item.hint}</p>
                  )}
                </div>
                {item.extraAction && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs shrink-0"
                    onClick={item.extraAction.onClick}
                  >
                    {item.extraAction.label}
                  </Button>
                )}
                {scheduled ? (
                  <Badge variant="secondary">Scheduled</Badge>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs shrink-0"
                    disabled={!canSchedule}
                    title={canSchedule ? undefined : "Switch to today to schedule"}
                    onClick={() => onSchedule(item.candidate)}
                  >
                    Schedule
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

function Timeline({
  blocks,
  todos,
  workouts,
  showNow,
  onSlotClick,
  onBlockClick,
}: {
  blocks: PlannerBlock[];
  todos: Todo[];
  workouts: Workout[];
  showNow: boolean;
  onSlotClick: (startMin: number) => void;
  onBlockClick: (block: PlannerBlock) => void;
}) {
  const minToPx = (min: number) =>
    Math.max(0, Math.min(TIMELINE_PX, ((min - DAY_START_MIN) / 60) * HOUR_PX));
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowVisible = showNow && nowMin >= DAY_START_MIN && nowMin < DAY_END_MIN;

  return (
    <div className="flex">
      {/* Hour gutter */}
      <div className="relative w-12 shrink-0" style={{ height: TIMELINE_PX }}>
        {TIMELINE_HOURS.map((h, i) => (
          <span
            key={h}
            className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums"
            style={{ top: i * HOUR_PX }}
          >
            {formatMin(h * 60)}
          </span>
        ))}
      </div>

      {/* Grid + content */}
      <div className="relative flex-1 border-l" style={{ height: TIMELINE_PX }}>
        {TIMELINE_HOURS.map((h, i) => (
          <button
            key={h}
            type="button"
            aria-label={`Add block at ${formatMin(h * 60)}`}
            onClick={() => onSlotClick(h * 60)}
            className="absolute inset-x-0 border-t border-border/60 hover:bg-accent/30 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
            style={{ top: i * HOUR_PX, height: HOUR_PX }}
          />
        ))}

        {/* Planner blocks */}
        {blocks.map((b) => {
          const top = minToPx(b.start_min);
          const height = Math.max(22, minToPx(b.start_min + b.duration_min) - top - 2);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onBlockClick(b)}
              className={cn(
                "absolute left-1 right-[30%] z-10 overflow-hidden rounded-md border px-2 py-0.5 text-left text-xs transition-shadow hover:shadow-sm",
                KIND_STYLES[b.kind],
                b.done && "opacity-50"
              )}
              style={{ top, height }}
            >
              <span className={cn("font-medium", b.done && "line-through")}>{b.title}</span>
              <span className="ml-1.5 opacity-70 tabular-nums">
                {formatMin(b.start_min)} · {b.duration_min}m
              </span>
            </button>
          );
        })}

        {/* Todo due-time markers (read-only) */}
        {todos.map((t) => {
          const min = t.due_at ? isoToMin(t.due_at) : null;
          if (min === null || min < DAY_START_MIN || min >= DAY_END_MIN) return null;
          return (
            <div
              key={t.id}
              className="absolute right-1 z-20 max-w-[28%] -translate-y-1/2"
              style={{ top: minToPx(min) }}
              title={`${t.title} — due ${formatMin(min)}`}
            >
              <span
                className={cn(
                  "flex items-center gap-1 rounded-full border bg-card px-1.5 py-0.5 text-[10px]",
                  t.is_done
                    ? "text-muted-foreground line-through"
                    : "border-amber-500/40 text-amber-600 dark:text-amber-400"
                )}
              >
                <CalendarClock className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{t.title}</span>
              </span>
            </div>
          );
        })}

        {/* Gym workout chips (read-only) */}
        {workouts.map((w) => {
          const min = isoToMin(w.performed_at);
          if (min < DAY_START_MIN || min >= DAY_END_MIN) return null;
          return (
            <div
              key={w.id}
              className="absolute right-1 z-20 max-w-[28%] translate-y-1"
              style={{ top: minToPx(min) }}
              title={`${w.name} · ${formatMin(min)}${w.duration_min ? ` · ${w.duration_min}m` : ""}`}
            >
              <span className="flex items-center gap-1 rounded-full border border-orange-500/40 bg-card px-1.5 py-0.5 text-[10px] text-orange-600 dark:text-orange-400">
                <Dumbbell className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{w.name}</span>
              </span>
            </div>
          );
        })}

        {/* Current time line */}
        {nowVisible && (
          <div
            className="pointer-events-none absolute inset-x-0 z-30 flex items-center"
            style={{ top: minToPx(nowMin) }}
            aria-hidden
          >
            <span className="h-2 w-2 -ml-1 rounded-full bg-primary" />
            <span className="h-px flex-1 bg-primary/60" />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block add/edit dialog
// ---------------------------------------------------------------------------

type BlockDraft = {
  title: string;
  kind: PlannerBlockKind;
  start_min: number;
  duration_min: number;
  done: boolean;
};

function BlockDialog({
  open,
  editing,
  defaultStartMin,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  editing: PlannerBlock | null;
  defaultStartMin: number;
  onClose: () => void;
  onSave: (draft: BlockDraft) => Promise<string | null>;
  onDelete: (block: PlannerBlock) => Promise<string | null>;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<PlannerBlockKind>("other");
  const [startTime, setStartTime] = useState("09:00");
  const [duration, setDuration] = useState("60");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setTitle(editing.title);
      setKind(editing.kind);
      setStartTime(minToTimeInput(editing.start_min));
      setDuration(String(editing.duration_min));
      setDone(editing.done);
    } else {
      setTitle("");
      setKind("other");
      setStartTime(minToTimeInput(defaultStartMin));
      setDuration("60");
      setDone(false);
    }
    setErr(null);
    setBusy(false);
  }, [open, editing, defaultStartMin]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setErr("Title is required.");
      return;
    }
    const startMin = timeInputToMin(startTime);
    if (startMin === null) {
      setErr("Enter a valid start time.");
      return;
    }
    const dur = Number(duration);
    if (!Number.isFinite(dur) || dur < 5 || dur > 720) {
      setErr("Duration must be 5–720 minutes.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const saveError = await onSave({
        title: trimmed,
        kind,
        start_min: startMin,
        duration_min: Math.round(dur),
        done,
      });
      if (saveError) setErr(saveError);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!editing || busy) return;
    if (!confirm(`Delete block "${editing.title}"?`)) return;
    setBusy(true);
    try {
      const delError = await onDelete(editing);
      if (delError) setErr(delError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Edit block" : "Add block"}
      description={
        editing
          ? "Adjust the block — changes save immediately."
          : "Reserve time on today's timeline."
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="block-title">Title</Label>
          <Input
            id="block-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Deep work: system design"
            maxLength={120}
            autoFocus
            required
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="block-kind">Kind</Label>
            <Select
              id="block-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as PlannerBlockKind)}
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="block-start">Start</Label>
            <Input
              id="block-start"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="[color-scheme:dark]"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="block-duration">Duration (min)</Label>
            <Input
              id="block-duration"
              type="number"
              min={5}
              max={720}
              inputMode="numeric"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              required
            />
          </div>
        </div>

        {editing && (
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={done}
              onChange={(e) => setDone(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-[hsl(var(--primary))]"
            />
            Mark as done
          </label>
        )}

        {err && (
          <p role="alert" className="text-sm text-destructive">
            {err}
          </p>
        )}

        <div className="flex items-center gap-2 pt-2">
          {editing && (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={handleDelete}
              disabled={busy}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              {busy ? "Saving…" : editing ? "Save changes" : "Add block"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
