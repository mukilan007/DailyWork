import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Mic,
  Minus,
  Pencil,
  Plus,
  Star,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
  INTERVIEW_KIND_LABELS,
  INTERVIEW_KIND_ORDER,
  PREP_CHART_COLORS,
  shortDate,
} from "@/lib/prep";
import type { MockInterview, MockInterviewKind } from "@/types";
import { cn } from "@/lib/utils";

const KIND_BADGE: Record<MockInterviewKind, "info" | "warning" | "success" | "default"> = {
  dsa: "info",
  system_design: "warning",
  behavioral: "success",
  full_loop: "default",
};

export function PrepInterviewsPage() {
  const { user } = useAuth();
  const [interviews, setInterviews] = useState<MockInterview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MockInterview | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error: err } = await supabase
        .from("mock_interviews")
        .select("*")
        .order("taken_on", { ascending: false })
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (err) setError(err.message);
      else setInterviews((data as MockInterview[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handleSave(draft: InterviewDraft) {
    if (!user) return;
    setError(null);
    if (editing) {
      const prev = interviews;
      setInterviews((is) =>
        is.map((i) => (i.id === editing.id ? { ...i, ...draft } : i))
      );
      const { data, error: err } = await supabase
        .from("mock_interviews")
        .update(draft)
        .eq("id", editing.id)
        .select()
        .single();
      if (err) {
        setInterviews(prev);
        setError(err.message);
        return;
      }
      if (data) {
        setInterviews((is) =>
          is.map((i) => (i.id === (data as MockInterview).id ? (data as MockInterview) : i))
        );
      }
    } else {
      const { data, error: err } = await supabase
        .from("mock_interviews")
        .insert({ user_id: user.id, ...draft })
        .select()
        .single();
      if (err) {
        setError(err.message);
        return;
      }
      if (data) {
        setInterviews((is) =>
          [data as MockInterview, ...is].sort(
            (a, b) =>
              b.taken_on.localeCompare(a.taken_on) ||
              b.created_at.localeCompare(a.created_at)
          )
        );
      }
    }
    setDialogOpen(false);
    setEditing(null);
  }

  async function handleDelete(iv: MockInterview) {
    if (!confirm(`Delete the ${INTERVIEW_KIND_LABELS[iv.kind]} mock from ${shortDate(iv.taken_on)}?`)) return;
    const prev = interviews;
    setInterviews((is) => is.filter((i) => i.id !== iv.id));
    const { error: err } = await supabase
      .from("mock_interviews")
      .delete()
      .eq("id", iv.id);
    if (err) {
      setInterviews(prev);
      setError(err.message);
    }
  }

  /** Chart data: rating over time, oldest → newest. */
  const chartData = useMemo(
    () =>
      interviews
        .slice()
        .sort(
          (a, b) =>
            a.taken_on.localeCompare(b.taken_on) ||
            a.created_at.localeCompare(b.created_at)
        )
        .map((i) => ({
          label: shortDate(i.taken_on),
          rating: i.self_rating,
        })),
    [interviews]
  );

  /** Per-kind: avg rating of last 5 vs previous 5 (newest-first input). */
  const kindStats = useMemo(() => {
    return INTERVIEW_KIND_ORDER.map((kind) => {
      const ofKind = interviews.filter((i) => i.kind === kind);
      const last5 = ofKind.slice(0, 5);
      const prev5 = ofKind.slice(5, 10);
      const avg = (xs: MockInterview[]) =>
        xs.length === 0
          ? null
          : xs.reduce((s, i) => s + i.self_rating, 0) / xs.length;
      return { kind, count: ofKind.length, recent: avg(last5), previous: avg(prev5) };
    });
  }, [interviews]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mock Interviews"
        icon={<Mic className="h-5 w-5" />}
        description={
          interviews.length === 0
            ? "Log every mock and watch the readiness curve climb."
            : `${interviews.length} mock${interviews.length === 1 ? "" : "s"} logged.`
        }
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            disabled={loading}
          >
            <Plus className="h-4 w-4" /> Log mock
          </Button>
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

      {loading ? (
        <SkeletonList rows={3} />
      ) : interviews.length === 0 ? (
        <EmptyState
          icon={<Mic className="h-7 w-7" />}
          title="No mocks logged yet"
          description="Record each mock interview with a self rating to build your readiness trend."
          action={
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Log mock
            </Button>
          }
        />
      ) : (
        <>
          {/* Readiness chart */}
          {chartData.length >= 2 && (
            <Card>
              <CardContent className="p-4 h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={PREP_CHART_COLORS.slate}
                      strokeOpacity={0.2}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: PREP_CHART_COLORS.slate }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      domain={[1, 5]}
                      ticks={[1, 2, 3, 4, 5]}
                      tick={{ fontSize: 11, fill: PREP_CHART_COLORS.slate }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      formatter={(v: number) => [`${v} / 5`, "Self rating"]}
                      wrapperStyle={{ fontSize: "12px" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="rating"
                      stroke={PREP_CHART_COLORS.primary}
                      strokeWidth={2}
                      dot={{ r: 3, fill: PREP_CHART_COLORS.primary, strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Per-kind trend tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {kindStats.map(({ kind, count, recent, previous }) => (
              <Card key={kind}>
                <CardContent className="p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {INTERVIEW_KIND_LABELS[kind]}
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-1.5">
                    <span className="text-2xl font-semibold tabular-nums leading-tight">
                      {recent === null ? "—" : recent.toFixed(1)}
                    </span>
                    {recent !== null && (
                      <span className="text-xs text-muted-foreground">/ 5 avg</span>
                    )}
                    <TrendArrow recent={recent} previous={previous} />
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {count === 0
                      ? "No mocks yet"
                      : previous === null
                      ? `last ${Math.min(count, 5)} mock${count === 1 ? "" : "s"}`
                      : `prev 5 avg ${previous.toFixed(1)}`}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Log, newest first */}
          <ul className="space-y-2">
            {interviews.map((iv) => (
              <InterviewRow
                key={iv.id}
                interview={iv}
                expanded={expandedId === iv.id}
                onToggle={() =>
                  setExpandedId((id) => (id === iv.id ? null : iv.id))
                }
                onEdit={() => {
                  setEditing(iv);
                  setDialogOpen(true);
                }}
                onDelete={() => void handleDelete(iv)}
              />
            ))}
          </ul>
        </>
      )}

      <InterviewDialog
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

// ---------- trend arrow ----------

function TrendArrow({
  recent,
  previous,
}: {
  recent: number | null;
  previous: number | null;
}) {
  if (recent === null || previous === null) return null;
  const delta = recent - previous;
  if (Math.abs(delta) < 0.05) {
    return <Minus className="h-4 w-4 text-muted-foreground" aria-label="No change" />;
  }
  return delta > 0 ? (
    <TrendingUp
      className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
      aria-label="Improving"
    />
  ) : (
    <TrendingDown
      className="h-4 w-4 text-rose-600 dark:text-rose-400"
      aria-label="Declining"
    />
  );
}

// ---------- stars ----------

function Stars({ rating }: { rating: number }) {
  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={`${rating} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            "h-3.5 w-3.5",
            n <= rating
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/40"
          )}
        />
      ))}
    </span>
  );
}

// ---------- list row ----------

function InterviewRow({
  interview,
  expanded,
  onToggle,
  onEdit,
  onDelete,
}: {
  interview: MockInterview;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hasDetail = !!(interview.questions || interview.feedback);
  return (
    <li>
      <Card className="group transition-shadow hover:shadow-sm">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onToggle}
              disabled={!hasDetail}
              aria-expanded={expanded}
              aria-label={expanded ? "Collapse details" : "Expand details"}
              className={cn(
                "shrink-0 rounded-md p-1 text-muted-foreground transition-transform",
                hasDetail ? "hover:bg-accent hover:text-foreground" : "opacity-30",
                expanded && "rotate-180"
              )}
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium tabular-nums">
                {shortDate(interview.taken_on)}
              </span>
              <span className="text-sm text-muted-foreground truncate">
                {interview.source}
              </span>
              <Badge variant={KIND_BADGE[interview.kind]}>
                {INTERVIEW_KIND_LABELS[interview.kind]}
              </Badge>
              <Stars rating={interview.self_rating} />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                aria-label="Edit mock interview"
                onClick={onEdit}
              >
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:text-destructive"
                aria-label="Delete mock interview"
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {expanded && hasDetail && (
            <div className="mt-3 ml-8 space-y-3 border-l-2 border-muted pl-4">
              {interview.questions && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Questions
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{interview.questions}</p>
                </div>
              )}
              {interview.feedback && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Feedback
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{interview.feedback}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

// ---------- add / edit dialog ----------

type InterviewDraft = {
  taken_on: string;
  source: string;
  kind: MockInterviewKind;
  self_rating: number;
  questions: string | null;
  feedback: string | null;
};

function InterviewDialog({
  open,
  editing,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: MockInterview | null;
  onClose: () => void;
  onSave: (draft: InterviewDraft) => Promise<void>;
}) {
  const [takenOn, setTakenOn] = useState(ymd());
  const [source, setSource] = useState("");
  const [kind, setKind] = useState<MockInterviewKind>("dsa");
  const [rating, setRating] = useState(3);
  const [questions, setQuestions] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setTakenOn(editing.taken_on);
      setSource(editing.source);
      setKind(editing.kind);
      setRating(editing.self_rating);
      setQuestions(editing.questions ?? "");
      setFeedback(editing.feedback ?? "");
    } else {
      setTakenOn(ymd());
      setSource("");
      setKind("dsa");
      setRating(3);
      setQuestions("");
      setFeedback("");
    }
    setErr(null);
  }, [open, editing]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const src = source.trim();
    if (!src) {
      setErr("Source is required — company, platform, or peer.");
      return;
    }
    if (rating < 1 || rating > 5) {
      setErr("Rating must be between 1 and 5.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await onSave({
        taken_on: takenOn || ymd(),
        source: src,
        kind,
        self_rating: rating,
        questions: questions.trim() ? questions.trim() : null,
        feedback: feedback.trim() ? feedback.trim() : null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Edit mock interview" : "Log mock interview"}
      description="Rate yourself honestly — the trend matters more than the number."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="mi-date">Taken on</Label>
            <DateField
              id="mi-date"
              value={takenOn}
              onChange={setTakenOn}
              quickPicks={false}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mi-kind">Kind</Label>
            <Select
              id="mi-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as MockInterviewKind)}
            >
              {INTERVIEW_KIND_ORDER.map((k) => (
                <option key={k} value={k}>
                  {INTERVIEW_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mi-source">Source</Label>
          <Input
            id="mi-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="e.g. Pramp, peer mock, Company XYZ"
            maxLength={200}
            autoFocus
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label>Self rating</Label>
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Self rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                onClick={() => setRating(n)}
                className="p-1 transition-transform active:scale-90"
              >
                <Star
                  className={cn(
                    "h-6 w-6 transition-colors",
                    n <= rating
                      ? "fill-amber-400 text-amber-400"
                      : "text-muted-foreground/40 hover:text-amber-400/60"
                  )}
                />
              </button>
            ))}
            <span className="ml-2 text-sm text-muted-foreground tabular-nums">
              {rating}/5
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mi-questions">Questions (optional)</Label>
          <Textarea
            id="mi-questions"
            value={questions}
            onChange={(e) => setQuestions(e.target.value)}
            placeholder="What was asked?"
            maxLength={4000}
            rows={3}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mi-feedback">Feedback (optional)</Label>
          <Textarea
            id="mi-feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What went well, what to fix next time…"
            maxLength={4000}
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
          <Button type="submit" disabled={saving || !source.trim()}>
            {saving ? "Saving…" : editing ? "Save changes" : "Log mock"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
