import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Code2,
  Download,
  ExternalLink,
  Filter,
  Flame,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Tag,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Dialog } from "@/components/ui/Dialog";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { formatDate, formatRelative } from "@/lib/dates";
import type { CodingProblemRow, LearnPhaseRow } from "@/types";
import {
  DIFFICULTY_LABEL,
  Difficulty,
  LearnPhaseStage,
  PHASE_LABEL,
  ProblemInput,
  PhaseInput,
  ProblemStatus,
  STATUS_LABEL,
  companyFrequencies,
  currentStreak,
  deletePhase,
  deleteProblem,
  fetchProblemMeta,
  importFromLocalStorage,
  insertPhase,
  insertProblem,
  listPhases,
  listProblems,
  normaliseTags,
  parseProblemUrl,
  tagFrequencies,
  updateProblem,
} from "@/lib/coding-tracker";

/** Difficulty → badge variant. Easy / medium / hard intuitively map to the
 *  app's success / warning / destructive palette. */
const DIFFICULTY_VARIANT: Record<Difficulty, "success" | "warning" | "destructive"> = {
  easy: "success",
  medium: "warning",
  hard: "destructive",
};

const STATUS_VARIANT: Record<ProblemStatus, "secondary" | "info" | "success"> = {
  todo: "secondary",
  in_progress: "info",
  solved: "success",
};

/** Today as YYYY-MM-DD in the user's local timezone — used for default
 *  solved-on dates and "solved this week" math. */
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgoYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CodingTrackerPage() {
  const { user } = useAuth();
  const [problems, setProblems] = useState<CodingProblemRow[]>([]);
  const [phases, setPhases] = useState<LearnPhaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [problemDialogOpen, setProblemDialogOpen] = useState(false);
  const [editingProblem, setEditingProblem] = useState<CodingProblemRow | null>(null);
  const [phaseDialogOpen, setPhaseDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: "problem"; id: string; label: string }
    | { kind: "phase"; id: string; label: string }
    | null
  >(null);

  // Filter state
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeCompany, setActiveCompany] = useState<string | null>(null);
  const [difficultyFilter, setDifficultyFilter] = useState<Difficulty | "">("");
  const [statusFilter, setStatusFilter] = useState<ProblemStatus | "">("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      // One-time migration of legacy browser-local data. Idempotent — a
      // failure leaves the localStorage keys in place for the next visit.
      try {
        const imported = await importFromLocalStorage(supabase, user.id);
        if (!cancelled && (imported.problems > 0 || imported.phases > 0)) {
          const parts: string[] = [];
          if (imported.problems > 0) {
            parts.push(`${imported.problems} problem${imported.problems === 1 ? "" : "s"}`);
          }
          if (imported.phases > 0) {
            parts.push(`${imported.phases} phase${imported.phases === 1 ? "" : "s"}`);
          }
          setImportNote(`Imported ${parts.join(" and ")} from this browser.`);
        }
      } catch {
        // Non-fatal: server data still loads; import retries next visit.
      }
      try {
        const [p, ph] = await Promise.all([
          listProblems(supabase, user.id),
          listPhases(supabase, user.id),
        ]);
        if (cancelled) return;
        setProblems(p);
        setPhases(ph);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  /* ────────────────────────── derived data ────────────────────────── */

  const tagFreq = useMemo(() => tagFrequencies(problems), [problems]);
  const sortedTags = useMemo(
    () => [...tagFreq.entries()].sort((a, b) => b[1] - a[1]),
    [tagFreq],
  );
  const sortedCompanies = useMemo(
    () => [...companyFrequencies(problems).entries()].sort((a, b) => b[1] - a[1]),
    [problems],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return problems.filter((p) => {
      if (activeTag && !p.tags.includes(activeTag)) return false;
      if (activeCompany && !(p.companies ?? []).includes(activeCompany)) return false;
      if (difficultyFilter && p.difficulty !== difficultyFilter) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (q) {
        const haystack = [
          p.title,
          p.url,
          p.platform,
          ...p.tags,
          ...(p.companies ?? []),
          p.notes ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [problems, search, activeTag, activeCompany, difficultyFilter, statusFilter]);

  const solvedThisWeek = useMemo(() => {
    const cutoff = daysAgoYmd(6);
    return problems.filter((p) => p.solved_on && p.solved_on >= cutoff).length;
  }, [problems]);

  const streak = useMemo(() => currentStreak(problems), [problems]);

  /* ───────────────────────── mutators ─────────────────────────────── */

  async function saveProblem(input: ProblemInput) {
    if (!user) throw new Error("Not signed in.");
    if (editingProblem) {
      const row = await updateProblem(supabase, editingProblem.id, input);
      setProblems((cur) => cur.map((p) => (p.id === row.id ? row : p)));
    } else {
      const row = await insertProblem(supabase, user.id, input);
      setProblems((cur) => [row, ...cur]);
    }
    setProblemDialogOpen(false);
    setEditingProblem(null);
  }

  async function addPhase(input: PhaseInput) {
    if (!user) throw new Error("Not signed in.");
    const row = await insertPhase(supabase, user.id, input);
    setPhases((cur) => [row, ...cur]);
    setPhaseDialogOpen(false);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const pd = pendingDelete;
    setPendingDelete(null);
    setError(null);
    try {
      if (pd.kind === "problem") {
        await deleteProblem(supabase, pd.id);
        setProblems((cur) => cur.filter((p) => p.id !== pd.id));
      } else {
        await deletePhase(supabase, pd.id);
        setPhases((cur) => cur.filter((p) => p.id !== pd.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /* ─────────────────────────── render ─────────────────────────────── */

  const hasActiveFilters =
    search.trim() !== "" ||
    activeTag !== null ||
    activeCompany !== null ||
    difficultyFilter !== "" ||
    statusFilter !== "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Coding Tracker"
        description="Log problems, group by tag, and track your software-dev learn phases."
        icon={<Code2 className="h-5 w-5" />}
        actions={
          <Button onClick={() => { setEditingProblem(null); setProblemDialogOpen(true); }} disabled={loading}>
            <Plus className="h-4 w-4" />
            Add problem
          </Button>
        }
      />

      {importNote && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
          {importNote}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Summary grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryStat
          label="Total problems"
          value={problems.length}
          icon={<Code2 className="h-4 w-4" />}
        />
        <SummaryStat
          label="Solved (7d)"
          value={solvedThisWeek}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <SummaryStat
          label="Current streak"
          value={streak}
          hint={streak === 1 ? "day" : "days"}
          icon={<Flame className="h-4 w-4" />}
        />
        <SummaryStat
          label="Top tag"
          value={sortedTags[0]?.[0] ?? "—"}
          hint={sortedTags[0] ? `${sortedTags[0][1]} problem${sortedTags[0][1] === 1 ? "" : "s"}` : undefined}
          icon={<Tag className="h-4 w-4" />}
        />
      </div>

      {/* Problems section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle>Problems</CardTitle>
              <CardDescription>
                Paste a problem URL — we'll detect the platform and you can tag it for grouping.
              </CardDescription>
            </div>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setActiveTag(null);
                  setActiveCompany(null);
                  setDifficultyFilter("");
                  setStatusFilter("");
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter row */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px] sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search problems"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, url, tags, companies…"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              Filter:
            </div>
            <Select
              aria-label="Filter by difficulty"
              value={difficultyFilter}
              onChange={(e) => setDifficultyFilter(e.target.value as Difficulty | "")}
              className="h-8 w-auto text-xs"
            >
              <option value="">Any difficulty</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
            <Select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ProblemStatus | "")}
              className="h-8 w-auto text-xs"
            >
              <option value="">Any status</option>
              <option value="todo">Todo</option>
              <option value="in_progress">In progress</option>
              <option value="solved">Solved</option>
            </Select>
          </div>

          {/* Tag chips */}
          {sortedTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {sortedTags.map(([tag, count]) => {
                const active = activeTag === tag;
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setActiveTag(active ? null : tag)}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition-colors",
                      active
                        ? "bg-primary text-primary-foreground ring-primary"
                        : "bg-secondary text-secondary-foreground ring-border hover:bg-secondary/80",
                    )}
                  >
                    {tag}
                    <span
                      className={cn(
                        "text-[10px] tabular-nums",
                        active ? "opacity-80" : "text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Company chips — e.g. click "amazon" then set difficulty Medium
              to see Amazon-tagged mediums. */}
          {sortedCompanies.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                Companies:
              </span>
              {sortedCompanies.map(([company, count]) => {
                const active = activeCompany === company;
                return (
                  <button
                    key={company}
                    type="button"
                    onClick={() => setActiveCompany(active ? null : company)}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition-colors",
                      active
                        ? "bg-sky-500 text-white ring-sky-500"
                        : "bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-sky-500/30 hover:bg-sky-500/20",
                    )}
                  >
                    {company}
                    <span className={cn("text-[10px] tabular-nums", active ? "opacity-80" : "opacity-70")}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* List */}
          {loading ? (
            <SkeletonList rows={3} />
          ) : filtered.length === 0 ? (
            <EmptyState
              bare
              icon={<Code2 className="h-6 w-6" />}
              title={problems.length === 0 ? "No problems logged yet" : "No matches for the current filters"}
              description={
                problems.length === 0
                  ? "Paste a problem link from LeetCode, HackerRank, Codeforces, GeeksforGeeks and more — the platform is auto-detected."
                  : "Try clearing the search or removing a filter."
              }
              action={
                problems.length === 0 && (
                  <Button onClick={() => { setEditingProblem(null); setProblemDialogOpen(true); }}>
                    <Plus className="h-4 w-4" />
                    Add your first problem
                  </Button>
                )
              }
            />
          ) : (
            <ul className="space-y-2">
              {filtered.map((p) => (
                <li
                  key={p.id}
                  className="flex items-start gap-3 rounded-lg border border-border/60 bg-card p-3"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-sm hover:underline truncate"
                      >
                        {p.title || p.url}
                        <ExternalLink className="inline-block h-3 w-3 ml-1 opacity-60" />
                      </a>
                      <Badge variant="outline">{p.platform || "Other"}</Badge>
                      <Badge variant={DIFFICULTY_VARIANT[p.difficulty]}>
                        {DIFFICULTY_LABEL[p.difficulty]}
                      </Badge>
                      <Badge variant={STATUS_VARIANT[p.status]}>
                        {STATUS_LABEL[p.status]}
                      </Badge>
                    </div>
                    {(p.tags.length > 0 || (p.companies ?? []).length > 0) && (
                      <div className="flex flex-wrap gap-1">
                        {p.tags.map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {t}
                          </span>
                        ))}
                        {(p.companies ?? []).map((c) => (
                          <span
                            key={c}
                            className="inline-flex items-center gap-0.5 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-600 dark:text-sky-400"
                          >
                            <Building2 className="h-2.5 w-2.5" />
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground">
                      {p.solved_on ? (
                        <>Solved {formatDate(`${p.solved_on}T00:00:00`)}</>
                      ) : (
                        <>Added {formatRelative(p.created_at)}</>
                      )}
                      {p.notes && <span className="ml-2 italic">· {p.notes}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingProblem(p);
                      setProblemDialogOpen(true);
                    }}
                    aria-label="Edit problem"
                    className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingDelete({ kind: "problem", id: p.id, label: p.title || p.url })
                    }
                    aria-label="Delete problem"
                    className="p-1.5 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Learn phases section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle>SWD learn phases</CardTitle>
              <CardDescription>
                Track structured upskilling topics through learning → mastered.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setPhaseDialogOpen(true)} disabled={loading}>
              <Plus className="h-4 w-4" />
              Add phase
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <SkeletonList rows={2} />
          ) : phases.length === 0 ? (
            <EmptyState
              bare
              icon={<Sparkles className="h-6 w-6" />}
              title="No phases tracked yet"
              description="Log topics you're working through — e.g. System Design, DP patterns, React internals — and move them through stages as you progress."
            />
          ) : (
            <ul className="space-y-2">
              {phases.map((ph) => (
                <li
                  key={ph.id}
                  className="flex items-start gap-3 rounded-lg border border-border/60 bg-card p-3"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{ph.topic}</span>
                      <Badge variant={ph.completed_on ? "success" : "info"}>
                        {PHASE_LABEL[ph.stage]}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Started {formatDate(`${ph.started_on}T00:00:00`)}
                      {ph.completed_on && (
                        <> · Completed {formatDate(`${ph.completed_on}T00:00:00`)}</>
                      )}
                      {ph.notes && <span className="ml-2 italic">· {ph.notes}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingDelete({ kind: "phase", id: ph.id, label: ph.topic })
                    }
                    aria-label="Delete phase"
                    className="p-1.5 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ProblemDialog
        open={problemDialogOpen}
        editing={editingProblem}
        onClose={() => {
          setProblemDialogOpen(false);
          setEditingProblem(null);
        }}
        onSave={saveProblem}
      />

      <AddPhaseDialog
        open={phaseDialogOpen}
        onClose={() => setPhaseDialogOpen(false)}
        onSave={addPhase}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.kind === "phase" ? "phase" : "problem"}?`}
        description={pendingDelete?.label}
        destructive
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

/* ─────────────────────────── summary card ─────────────────────────── */

function SummaryStat({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
        </div>
        <p className="mt-2 text-2xl font-semibold tracking-tight truncate">{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground truncate">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/* ───────────────────────── add / edit problem ─────────────────────── */

function ProblemDialog({
  open,
  editing,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: CodingProblemRow | null;
  onClose: () => void;
  onSave: (input: ProblemInput) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [status, setStatus] = useState<ProblemStatus>("todo");
  const [tagInput, setTagInput] = useState("");
  const [companyInput, setCompanyInput] = useState("");
  const [solvedOn, setSolvedOn] = useState("");
  const [notes, setNotes] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [tagsTouched, setTagsTouched] = useState(false);
  const [diffTouched, setDiffTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** "idle" before any fetch, "loading" while the proxy call is in flight,
   *  "ok" after a successful merge, "empty" when the proxy returned but no
   *  fields were recognisable, "error" on network failure. */
  const [fetchState, setFetchState] = useState<"idle" | "loading" | "ok" | "empty" | "error">("idle");
  const [fetchMsg, setFetchMsg] = useState<string>("");
  // Bumped whenever an in-flight fetch's result must be discarded (dialog
  // closed, URL edited, newer fetch fired) — a late response for a stale
  // token must not fill the form.
  const fetchToken = useRef(0);

  useEffect(() => {
    if (open && editing) {
      // Hydrate from the row being edited. Mark fields as touched so URL
      // re-parsing / fetch-details can't stomp the stored values.
      setUrl(editing.url);
      setTitle(editing.title);
      setPlatform(editing.platform);
      setDifficulty(editing.difficulty);
      setStatus(editing.status);
      setTagInput(editing.tags.join(", "));
      setCompanyInput((editing.companies ?? []).join(", "));
      setSolvedOn(editing.solved_on ?? "");
      setNotes(editing.notes ?? "");
      setTitleTouched(true);
      setTagsTouched(true);
      setDiffTouched(true);
      setSaving(false);
      setSaveError(null);
      setFetchState("idle");
      setFetchMsg("");
      return;
    }
    if (!open) {
      fetchToken.current += 1;
      setUrl("");
      setTitle("");
      setPlatform("");
      setDifficulty("medium");
      setStatus("todo");
      setTagInput("");
      setCompanyInput("");
      setSolvedOn("");
      setNotes("");
      setTitleTouched(false);
      setTagsTouched(false);
      setDiffTouched(false);
      setSaving(false);
      setSaveError(null);
      setFetchState("idle");
      setFetchMsg("");
    }
  }, [open, editing]);

  /** Fire the proxy fetch and merge whatever fields it returns — but never
   *  stomp values the user has already typed (the *Touched flags). */
  async function onFetchDetails() {
    if (!url.trim() || fetchState === "loading") return;
    const token = ++fetchToken.current;
    setFetchState("loading");
    setFetchMsg("");
    const meta = await fetchProblemMeta(url);
    // Stale: dialog closed or URL changed while the request was in flight.
    if (token !== fetchToken.current) return;
    let filled = 0;
    if (meta.title && !titleTouched) {
      setTitle(meta.title);
      filled += 1;
    }
    if (meta.difficulty && !diffTouched) {
      setDifficulty(meta.difficulty);
      filled += 1;
    }
    if (meta.tags && meta.tags.length > 0 && !tagsTouched) {
      setTagInput(meta.tags.join(", "));
      filled += 1;
    }
    if (filled === 0) {
      setFetchState("empty");
      setFetchMsg("Couldn't read any details — fill the form manually.");
    } else {
      setFetchState("ok");
      setFetchMsg(`Filled ${filled} field${filled === 1 ? "" : "s"} from the page.`);
    }
  }

  // Default solved_on to today the moment status flips to "solved", but only
  // if the user hasn't already typed something.
  useEffect(() => {
    if (status === "solved" && !solvedOn) setSolvedOn(todayYmd());
  }, [status, solvedOn]);

  // Auto-detect platform + title as the user types/pastes the URL. The user
  // can still override either field (titleTouched flag prevents stomp).
  function onUrlChange(next: string) {
    setUrl(next);
    const parsed = parseProblemUrl(next);
    setPlatform(parsed.platform);
    if (!titleTouched) setTitle(parsed.titleGuess);
    // Editing the URL invalidates the previous fetch result — including one
    // still in flight, whose response would belong to the old URL.
    fetchToken.current += 1;
    setFetchState("idle");
    setFetchMsg("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        url: url.trim(),
        title: title.trim() || url.trim(),
        platform: platform.trim(),
        difficulty,
        status,
        tags: normaliseTags(tagInput),
        companies: normaliseTags(companyInput),
        solved_on: status === "solved" ? (solvedOn || todayYmd()) : null,
        notes: notes.trim() || null,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Edit problem" : "Add problem"}
      description="Track a coding problem with tags and companies for grouping and filtering."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="p-url">Problem URL</Label>
          <div className="flex gap-2">
            <Input
              id="p-url"
              type="url"
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="https://leetcode.com/problems/two-sum"
              required
              autoFocus
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={onFetchDetails}
              disabled={!url.trim() || fetchState === "loading"}
              title="Read difficulty, title, and tags from the problem page"
            >
              {fetchState === "loading" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Fetch details
            </Button>
          </div>
          {fetchMsg && (
            <p
              className={cn(
                "text-[11px]",
                fetchState === "ok" && "text-emerald-600 dark:text-emerald-400",
                fetchState === "empty" && "text-amber-600 dark:text-amber-400",
                fetchState === "error" && "text-rose-600 dark:text-rose-400",
              )}
            >
              {fetchMsg}
            </p>
          )}
          {fetchState === "idle" && (
            <p className="text-[11px] text-muted-foreground">
              Click "Fetch details" to auto-fill title, difficulty, and tags from the page.
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="p-title">Title</Label>
            <Input
              id="p-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleTouched(true);
              }}
              placeholder="Auto-filled from URL"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-platform">Platform</Label>
            <Input
              id="p-platform"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              placeholder="LeetCode, HackerRank…"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="p-diff">Difficulty</Label>
            <Select
              id="p-diff"
              value={difficulty}
              onChange={(e) => {
                setDifficulty(e.target.value as Difficulty);
                setDiffTouched(true);
              }}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-status">Status</Label>
            <Select id="p-status" value={status} onChange={(e) => setStatus(e.target.value as ProblemStatus)}>
              <option value="todo">Todo</option>
              <option value="in_progress">In progress</option>
              <option value="solved">Solved</option>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-tags">Tags</Label>
          <Input
            id="p-tags"
            value={tagInput}
            onChange={(e) => {
              setTagInput(e.target.value);
              setTagsTouched(true);
            }}
            placeholder="arrays, two-pointers, dp"
          />
          <p className="text-[11px] text-muted-foreground">Comma-separated. Used to group and filter problems.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-companies">Companies</Label>
          <Input
            id="p-companies"
            value={companyInput}
            onChange={(e) => setCompanyInput(e.target.value)}
            placeholder="amazon, google, zoho"
          />
          <p className="text-[11px] text-muted-foreground">
            Comma-separated target companies — filter e.g. Amazon-tagged mediums.
          </p>
        </div>
        {status === "solved" && (
          <div className="space-y-1.5">
            <Label htmlFor="p-solved-on">Solved on</Label>
            <Input
              id="p-solved-on"
              type="date"
              value={solvedOn}
              onChange={(e) => setSolvedOn(e.target.value)}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="p-notes">Notes</Label>
          <Textarea
            id="p-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Approach, gotchas, links to write-ups…"
            rows={2}
          />
        </div>
        {saveError && (
          <p role="alert" className="text-sm text-destructive">
            {saveError}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Save problem"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ─────────────────────────── add phase ────────────────────────────── */

function AddPhaseDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (input: PhaseInput) => Promise<void>;
}) {
  const [topic, setTopic] = useState("");
  const [stage, setStage] = useState<LearnPhaseStage>("learning");
  const [startedOn, setStartedOn] = useState(todayYmd());
  const [completedOn, setCompletedOn] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTopic("");
      setStage("learning");
      setStartedOn(todayYmd());
      setCompletedOn("");
      setNotes("");
      setSaving(false);
      setSaveError(null);
    }
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const t = topic.trim();
    if (!t || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        topic: t,
        stage,
        started_on: startedOn || todayYmd(),
        completed_on: stage === "mastered" ? (completedOn || todayYmd()) : (completedOn || null),
        notes: notes.trim() || null,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add learn phase" description="Track a topic you're working through.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ph-topic">Topic</Label>
          <Input
            id="ph-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. System design, Dynamic programming"
            required
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ph-stage">Stage</Label>
            <Select id="ph-stage" value={stage} onChange={(e) => setStage(e.target.value as LearnPhaseStage)}>
              <option value="learning">Learning</option>
              <option value="practicing">Practicing</option>
              <option value="reviewing">Reviewing</option>
              <option value="mastered">Mastered</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ph-start">Started on</Label>
            <Input
              id="ph-start"
              type="date"
              value={startedOn}
              onChange={(e) => setStartedOn(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ph-complete">Completed on</Label>
          <Input
            id="ph-complete"
            type="date"
            value={completedOn}
            onChange={(e) => setCompletedOn(e.target.value)}
            placeholder="Leave blank while ongoing"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ph-notes">Notes</Label>
          <Textarea
            id="ph-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Resources, milestones, takeaways…"
            rows={2}
          />
        </div>
        {saveError && (
          <p role="alert" className="text-sm text-destructive">
            {saveError}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save phase"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
