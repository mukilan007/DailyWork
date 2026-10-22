import { FormEvent, useEffect, useMemo, useState } from "react";
import { ClipboardList, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DateField } from "@/components/ui/DateField";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { SkeletonList } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { ReportDialog } from "@/components/report/ReportDialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { addDays, ymd } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  buildWorkLogReport,
  downloadReport,
  formatDay,
  formatMinutes,
  STATUS_LABEL,
} from "@/lib/work-log-report";
import type { EntryType, WorkLogEntry, WorkLogStatus } from "@/types";

const STATUSES: WorkLogStatus[] = [
  "open",
  "in_progress",
  "review",
  "fixed_in_developer",
  "validation",
  "fixed",
  "not_an_issue",
  "later",
  "not_reproduced",
  "completed",
  "closed",
  "on_hold",
];

/** Entry kinds. Tasks read as prose in the report; issues and bugs are
 *  tabular, so they render as tables there. */
const ENTRY_TYPES: Array<{ value: EntryType; label: string }> = [
  { value: "task", label: "Task" },
  { value: "customer_issue", label: "Customer Issue" },
  { value: "bugtracker", label: "Bugtracker" },
];

/** Badge tint per state. Terminal states lean green, work-in-flight blue,
 *  parked states amber, and "not an issue" / "not reproduced" stay neutral —
 *  they are outcomes, not problems. */
const STATUS_STYLE: Record<WorkLogStatus, string> = {
  open: "bg-slate-500/10 text-slate-400 ring-slate-500/20",
  in_progress: "bg-blue-500/10 text-blue-400 ring-blue-500/20",
  review: "bg-indigo-500/10 text-indigo-400 ring-indigo-500/20",
  fixed_in_developer: "bg-sky-500/10 text-sky-400 ring-sky-500/20",
  validation: "bg-teal-500/10 text-teal-400 ring-teal-500/20",
  fixed: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
  not_an_issue: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20",
  later: "bg-violet-500/10 text-violet-400 ring-violet-500/20",
  not_reproduced: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20",
  completed: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
  closed: "bg-slate-500/10 text-slate-300 ring-slate-500/20",
  on_hold: "bg-amber-500/10 text-amber-400 ring-amber-500/20",
};

/** How far back the list/report window starts, as presets. */
const PERIOD_PRESETS = [
  { key: "7", label: "Last 7 days", days: 6 },
  { key: "30", label: "Last 30 days", days: 29 },
  { key: "90", label: "Last 90 days", days: 89 },
] as const;

export function WorkLogPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<WorkLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Period window — drives both the list below and the report range.
  const [from, setFrom] = useState(() => ymd(addDays(new Date(), -29)));
  const [to, setTo] = useState(() => ymd());

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WorkLogEntry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorkLogEntry | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Order-corrected window, so a backwards From/To still queries sensibly.
  const window_ = useMemo(
    () => (from <= to ? { from, to } : { from: to, to: from }),
    [from, to]
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from("work_log")
        .select("*")
        .gte("worked_on", window_.from)
        .lte("worked_on", window_.to)
        .order("worked_on", { ascending: false })
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (err) setError(err.message);
      else setEntries((data as WorkLogEntry[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, window_.from, window_.to]);

  // Previously-used values, offered as datalist suggestions so the free text
  // stays consistent without needing lookup tables.
  const { knownCategories, knownModules } = useMemo(() => {
    const cats = new Set<string>();
    const mods = new Set<string>();
    for (const e of entries) {
      const c = e.category?.trim();
      if (c) cats.add(c);
      const m = e.module?.trim();
      if (m) mods.add(m);
    }
    const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
    return { knownCategories: sorted(cats), knownModules: sorted(mods) };
  }, [entries]);

  // The report normalises rows into generic items; the list needs the real
  // WorkLogEntry (edit/delete act on it), so group separately here.
  const uiDays = useMemo(() => {
    const byDay = new Map<string, WorkLogEntry[]>();
    for (const e of entries) {
      const list = byDay.get(e.worked_on);
      if (list) list.push(e);
      else byDay.set(e.worked_on, [e]);
    }
    return [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, list]) => ({
        day,
        entries: list,
        minutes: list.reduce((sum, e) => sum + (e.minutes ?? 0), 0),
      }));
  }, [entries]);

  const report = useMemo(
    () =>
      buildWorkLogReport(entries, {
        from: window_.from,
        to: window_.to,
        author: user?.email ?? undefined,
      }),
    [entries, window_.from, window_.to, user]
  );

  async function handleSave(draft: Omit<WorkLogEntry, "id" | "user_id" | "created_at" | "updated_at" | "position">) {
    if (!user) return;
    setBusy(true);
    setError(null);
    if (editing) {
      const { data, error: err } = await supabase
        .from("work_log")
        .update({ ...draft, updated_at: new Date().toISOString() })
        .eq("id", editing.id)
        .select()
        .single();
      if (err) setError(err.message);
      else if (data) {
        const row = data as WorkLogEntry;
        setEntries((cur) =>
          cur
            .map((e) => (e.id === row.id ? row : e))
            // The day may have changed, so re-sort rather than patch in place.
            .sort(
              (a, b) =>
                b.worked_on.localeCompare(a.worked_on) ||
                a.position - b.position ||
                a.created_at.localeCompare(b.created_at)
            )
        );
      }
    } else {
      const sameDay = entries.filter((e) => e.worked_on === draft.worked_on);
      const { data, error: err } = await supabase
        .from("work_log")
        .insert({ ...draft, user_id: user.id, position: sameDay.length })
        .select()
        .single();
      if (err) setError(err.message);
      else if (data) {
        const row = data as WorkLogEntry;
        setEntries((cur) =>
          [row, ...cur].sort(
            (a, b) =>
              b.worked_on.localeCompare(a.worked_on) ||
              a.position - b.position ||
              a.created_at.localeCompare(b.created_at)
          )
        );
      }
    }
    setBusy(false);
    setDialogOpen(false);
    setEditing(null);
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    const { error: err } = await supabase
      .from("work_log")
      .delete()
      .eq("id", confirmDelete.id);
    if (err) setError(err.message);
    else setEntries((cur) => cur.filter((e) => e.id !== confirmDelete.id));
    setBusy(false);
    setConfirmDelete(null);
  }

  function startAdd() {
    setEditing(null);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work Done"
        description="Log what you worked on each day, then export the period as a report."
        icon={<ClipboardList className="h-5 w-5" />}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => setReportOpen(true)}
              disabled={loading || entries.length === 0}
            >
              <Download className="h-4 w-4" /> Report
            </Button>
            <Button onClick={startAdd}>
              <Plus className="h-4 w-4" /> Log work
            </Button>
          </>
        }
      />

      {/* Period window — shared by the list and the report. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[9rem] flex-1 space-y-1 sm:max-w-[13rem]">
          <Label htmlFor="wl-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <DateField id="wl-from" value={from} onChange={setFrom} quickPicks={false} />
        </div>
        <div className="min-w-[9rem] flex-1 space-y-1 sm:max-w-[13rem]">
          <Label htmlFor="wl-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <DateField id="wl-to" value={to} onChange={setTo} quickPicks={false} />
        </div>
        <div className="flex items-center gap-1.5">
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                setFrom(ymd(addDays(new Date(), -p.days)));
                setTo(ymd());
              }}
              className="h-9 rounded-md border border-input px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm text-rose-500" role="alert">
          {error}
        </p>
      )}

      {/* Period summary */}
      <Card>
        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-4 gap-1.5 sm:gap-4 text-left sm:text-center">
          <Stat label="Tasks" value={String(report.totals.entries)} />
          <Stat label="Days worked" value={String(report.totals.daysWorked)} />
          <Stat label="Time logged" value={formatMinutes(report.totals.minutes)} />
          <Stat
            label="Done"
            value={`${report.totals.doneCount}/${report.totals.entries}`}
          />
        </CardContent>
      </Card>

      {loading ? (
        <SkeletonList />
      ) : uiDays.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-6 w-6" />}
          title="Nothing logged in this period"
          description="Add what you worked on and it'll show up here, grouped by day."
          action={
            <Button onClick={startAdd}>
              <Plus className="h-4 w-4" /> Log work
            </Button>
          }
        />
      ) : (
        <div className="space-y-5">
          {uiDays.map((d) => (
            <section key={d.day} className="space-y-2">
              <div className="flex items-baseline justify-between gap-3 border-b pb-1.5">
                <h2 className="text-sm font-semibold">{formatDay(d.day)}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {d.entries.length} task{d.entries.length === 1 ? "" : "s"} ·{" "}
                  {formatMinutes(d.minutes)}
                </span>
              </div>
              {d.entries.map((e) => (
                <div
                  key={e.id}
                  className="group flex items-start gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{e.title}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                          STATUS_STYLE[e.status]
                        )}
                      >
                        {STATUS_LABEL[e.status]}
                      </span>
                      {e.module && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary ring-1 ring-inset ring-primary/20">
                          {e.module}
                        </span>
                      )}
                      {e.category && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          {e.category}
                        </span>
                      )}
                      {e.minutes ? (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {formatMinutes(e.minutes)}
                        </span>
                      ) : null}
                    </div>
                    {e.details && (
                      <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                        {e.details}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1 -mt-1 -mr-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 transition-opacity"
                      aria-label={`Edit ${e.title}`}
                      onClick={() => {
                        setEditing(e);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 transition-opacity hover:text-destructive"
                      aria-label={`Delete ${e.title}`}
                      onClick={() => setConfirmDelete(e)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      <EntryDialog
        open={dialogOpen}
        editing={editing}
        knownCategories={knownCategories}
        knownModules={knownModules}
        busy={busy}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />

      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        from={window_.from}
        to={window_.to}
        entryCount={report.totals.entries}
        report={report}
        onDownload={(fmt, fields) => downloadReport(report, fmt, fields)}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this entry?"
        description={confirmDelete?.title}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 sm:block">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

type EntryDraft = Omit<
  WorkLogEntry,
  "id" | "user_id" | "created_at" | "updated_at" | "position"
>;

function EntryDialog({
  open,
  editing,
  knownCategories,
  knownModules,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: WorkLogEntry | null;
  knownCategories: string[];
  knownModules: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (draft: EntryDraft) => void;
}) {
  const [workedOn, setWorkedOn] = useState(() => ymd());
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [category, setCategory] = useState("");
  const [moduleName, setModuleName] = useState("");
  const [status, setStatus] = useState<WorkLogStatus>("completed");
  const [entryType, setEntryType] = useState<EntryType>("task");
  const [hours, setHours] = useState("");
  const [mins, setMins] = useState("");

  // Reset the form whenever the dialog opens, so a stale draft from a
  // previous edit can never leak into the next entry.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setWorkedOn(editing.worked_on);
      setTitle(editing.title);
      setDetails(editing.details ?? "");
      setCategory(editing.category ?? "");
      setModuleName(editing.module ?? "");
      setStatus(editing.status);
      setEntryType(editing.entry_type);
      const m = editing.minutes ?? 0;
      setHours(m >= 60 ? String(Math.floor(m / 60)) : "");
      setMins(m % 60 > 0 ? String(m % 60) : m > 0 && m < 60 ? String(m) : "");
    } else {
      setWorkedOn(ymd());
      setTitle("");
      setDetails("");
      setCategory("");
      setModuleName("");
      setStatus("completed");
      setEntryType("task");
      setHours("");
      setMins("");
    }
  }, [open, editing]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    const total = (Number(hours) || 0) * 60 + (Number(mins) || 0);
    onSave({
      worked_on: workedOn,
      title: t,
      details: details.trim() || null,
      category: category.trim() || null,
      module: moduleName.trim() || null,
      status,
      entry_type: entryType,
      minutes: total > 0 ? Math.min(total, 1440) : null,
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Edit entry" : "Log work"}
      description={
        editing
          ? "Update what you recorded for this task."
          : "What did you work on? One entry per task."
      }
      resizable
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="wl-date">Date</Label>
          <DateField id="wl-date" value={workedOn} onChange={setWorkedOn} max={ymd()} />
        </div>

        <div className="space-y-1.5">
          <Label>Type</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Entry type">
            {ENTRY_TYPES.map((t) => (
              <label
                key={t.value}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                  entryType === t.value
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-input text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <input
                  type="radio"
                  name="wl-entry-type"
                  value={t.value}
                  checked={entryType === t.value}
                  onChange={() => setEntryType(t.value)}
                />
                {t.label}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="wl-title">Task/ID</Label>
          <Input
            id="wl-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What did you work on?"
            maxLength={200}
            autoFocus
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="wl-details">Details</Label>
          <Textarea
            id="wl-details"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="What you did, decisions made, what's next…"
            maxLength={5000}
            className="h-32"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="wl-module">Module</Label>
            <Input
              id="wl-module"
              value={moduleName}
              onChange={(e) => setModuleName(e.target.value)}
              placeholder="e.g. Finance, Todos"
              maxLength={100}
              list="wl-module-options"
            />
            <datalist id="wl-module-options">
              {knownModules.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wl-category">Category</Label>
            <Input
              id="wl-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Backend, Review"
              maxLength={100}
              list="wl-category-options"
            />
            <datalist id="wl-category-options">
              {knownCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wl-status">Status</Label>
            <Select
              id="wl-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as WorkLogStatus)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="wl-hours">Time spent</Label>
          <div className="flex items-center gap-2">
            <Input
              id="wl-hours"
              type="number"
              min={0}
              max={24}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="0"
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">h</span>
            <Input
              id="wl-mins"
              type="number"
              min={0}
              max={59}
              value={mins}
              onChange={(e) => setMins(e.target.value)}
              placeholder="0"
              className="w-20"
              aria-label="Minutes spent"
            />
            <span className="text-sm text-muted-foreground">m</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !title.trim()}>
            {editing ? "Save changes" : "Add entry"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
