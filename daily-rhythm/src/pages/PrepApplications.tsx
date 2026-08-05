import { DragEvent, FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Briefcase,
  CalendarClock,
  ExternalLink,
  Plus,
  Trash2,
  UserCheck,
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
  APP_STAGE_LABELS,
  APP_STAGE_ORDER,
  isUniqueViolation,
  shortDate,
} from "@/lib/prep";
import type { ApplicationStage, JobApplication } from "@/types";
import { cn } from "@/lib/utils";

const STAGE_ACCENT: Record<ApplicationStage, string> = {
  wishlist: "border-t-slate-400",
  applied: "border-t-sky-500",
  oa: "border-t-violet-500",
  interview: "border-t-amber-500",
  offer: "border-t-emerald-500",
  rejected: "border-t-rose-500",
};

export function PrepApplicationsPage() {
  const { user } = useAuth();
  const [apps, setApps] = useState<JobApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<JobApplication | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<ApplicationStage | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error: err } = await supabase
        .from("job_applications")
        .select("*")
        .order("position");
      if (cancelled) return;
      if (err) setError(err.message);
      else setApps((data as JobApplication[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const byStage = useMemo(() => {
    const map = new Map<ApplicationStage, JobApplication[]>();
    for (const s of APP_STAGE_ORDER) map.set(s, []);
    for (const a of apps) (map.get(a.stage) ?? map.get("wishlist")!).push(a);
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [apps]);

  const summary = useMemo(() => {
    const today = ymd();
    const active = apps.filter(
      (a) => a.stage !== "rejected" && a.stage !== "offer"
    ).length;
    const interviews = apps.filter((a) => a.stage === "interview").length;
    const followUpsDue = apps.filter(
      (a) =>
        a.stage !== "rejected" && a.follow_up_on !== null && a.follow_up_on <= today
    ).length;
    return { active, interviews, followUpsDue };
  }, [apps]);

  /** Move an app to a stage, appended at the end of the target column. */
  async function moveToStage(app: JobApplication, stage: ApplicationStage) {
    if (app.stage === stage) return;
    const targetList = byStage.get(stage) ?? [];
    const nextPos =
      targetList.length === 0
        ? 1
        : Math.max(...targetList.map((a) => a.position)) + 1;
    const prev = apps;
    setApps((as) =>
      as.map((a) => (a.id === app.id ? { ...a, stage, position: nextPos } : a))
    );
    const { error: err } = await supabase
      .from("job_applications")
      .update({ stage, position: nextPos })
      .eq("id", app.id);
    if (err) {
      setApps(prev);
      setError(err.message);
    }
  }

  function onDrop(e: DragEvent, stage: ApplicationStage) {
    e.preventDefault();
    setDragOverStage(null);
    const id = e.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    if (!id) return;
    const app = apps.find((a) => a.id === id);
    if (app) void moveToStage(app, stage);
  }

  async function handleSave(draft: AppDraft): Promise<void> {
    if (!user) return;
    setError(null);
    if (editing) {
      const prev = apps;
      // Stage changes from the dialog append to the end of the new column.
      let patch: Partial<JobApplication> = { ...draft };
      if (draft.stage !== editing.stage) {
        const targetList = (byStage.get(draft.stage) ?? []).filter(
          (a) => a.id !== editing.id
        );
        patch.position =
          targetList.length === 0
            ? 1
            : Math.max(...targetList.map((a) => a.position)) + 1;
      }
      setApps((as) => as.map((a) => (a.id === editing.id ? { ...a, ...patch } : a)));
      const { data, error: err } = await supabase
        .from("job_applications")
        .update(patch)
        .eq("id", editing.id)
        .select()
        .single();
      if (err) {
        setApps(prev);
        if (isUniqueViolation(err)) {
          throw new Error(
            `You already track "${draft.role}" at ${draft.company}.`
          );
        }
        setError(err.message);
        return;
      }
      if (data) {
        setApps((as) =>
          as.map((a) => (a.id === (data as JobApplication).id ? (data as JobApplication) : a))
        );
      }
    } else {
      const list = byStage.get(draft.stage) ?? [];
      const position =
        list.length === 0 ? 1 : Math.max(...list.map((a) => a.position)) + 1;
      const { data, error: err } = await supabase
        .from("job_applications")
        .insert({ user_id: user.id, ...draft, position })
        .select()
        .single();
      if (err) {
        if (isUniqueViolation(err)) {
          throw new Error(
            `You already track "${draft.role}" at ${draft.company}.`
          );
        }
        setError(err.message);
        return;
      }
      if (data) setApps((as) => [...as, data as JobApplication]);
    }
    setDialogOpen(false);
    setEditing(null);
  }

  async function handleDelete(app: JobApplication) {
    if (!confirm(`Delete ${app.company} — ${app.role}?`)) return;
    const prev = apps;
    setApps((as) => as.filter((a) => a.id !== app.id));
    setDialogOpen(false);
    setEditing(null);
    const { error: err } = await supabase
      .from("job_applications")
      .delete()
      .eq("id", app.id);
    if (err) {
      setApps(prev);
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Applications"
        icon={<Briefcase className="h-5 w-5" />}
        description={
          apps.length === 0
            ? "Track every application from wishlist to offer."
            : `${apps.length} application${apps.length === 1 ? "" : "s"} tracked.`
        }
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            disabled={loading}
          >
            <Plus className="h-4 w-4" /> Add application
          </Button>
        }
      />

      {apps.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <SummaryTile label="Active" value={summary.active} accent="primary" />
          <SummaryTile label="Interviewing" value={summary.interviews} accent="warning" />
          <SummaryTile
            label="Follow-ups due"
            value={summary.followUpsDue}
            accent={summary.followUpsDue > 0 ? "danger" : "muted"}
          />
        </div>
      )}

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
      ) : apps.length === 0 ? (
        <EmptyState
          icon={<Briefcase className="h-7 w-7" />}
          title="No applications yet"
          description="Add companies you want to apply to and drag cards across the board as things move."
          action={
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Add application
            </Button>
          }
        />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1">
          {APP_STAGE_ORDER.map((stage) => {
            const list = byStage.get(stage) ?? [];
            return (
              <div
                key={stage}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverStage(stage);
                }}
                onDragLeave={() => setDragOverStage((s) => (s === stage ? null : s))}
                onDrop={(e) => onDrop(e, stage)}
                className={cn(
                  "w-64 shrink-0 rounded-xl border bg-muted/30 border-t-4 transition-colors",
                  STAGE_ACCENT[stage],
                  dragOverStage === stage && "bg-primary/5 border-primary/40"
                )}
              >
                <div className="flex items-center justify-between px-3 py-2.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {APP_STAGE_LABELS[stage]}
                  </h3>
                  <span className="text-[11px] text-muted-foreground tabular-nums rounded-full bg-muted px-1.5 py-0.5">
                    {list.length}
                  </span>
                </div>
                <ul className="space-y-2 px-2 pb-2 min-h-[60px]">
                  {list.map((app) => (
                    <AppCard
                      key={app.id}
                      app={app}
                      dragging={draggingId === app.id}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", app.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDraggingId(app.id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverStage(null);
                      }}
                      onOpen={() => {
                        setEditing(app);
                        setDialogOpen(true);
                      }}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <AppDialog
        open={dialogOpen}
        editing={editing}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </div>
  );
}

// ---------- summary tile ----------

function SummaryTile({
  label,
  value,
  accent = "muted",
}: {
  label: string;
  value: number;
  accent?: "primary" | "warning" | "danger" | "muted";
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div
          className={cn(
            "text-2xl font-semibold tabular-nums leading-tight mt-0.5",
            accent === "primary" && "text-primary",
            accent === "warning" && "text-amber-600 dark:text-amber-400",
            accent === "danger" && "text-rose-600 dark:text-rose-400",
            accent === "muted" && "text-muted-foreground"
          )}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- kanban card ----------

function AppCard({
  app,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  app: JobApplication;
  dragging: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  const today = ymd();
  const followUpOverdue =
    !!app.follow_up_on && app.follow_up_on < today && app.stage !== "rejected";
  const followUpToday = app.follow_up_on === today && app.stage !== "rejected";

  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn("cursor-grab active:cursor-grabbing", dragging && "opacity-40")}
    >
      <Card
        className="transition-shadow hover:shadow-sm"
        onClick={onOpen}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        aria-label={`${app.company} — ${app.role}`}
      >
        <CardContent className="p-3 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium leading-snug truncate">
                {app.company}
              </div>
              <div className="text-xs text-muted-foreground truncate">{app.role}</div>
            </div>
            {app.referral_contact && (
              <span
                title={`Referral: ${app.referral_contact}`}
                className="shrink-0 text-emerald-600 dark:text-emerald-400"
              >
                <UserCheck className="h-4 w-4" />
              </span>
            )}
          </div>
          {app.follow_up_on && (
            <Badge
              variant={
                followUpOverdue ? "destructive" : followUpToday ? "warning" : "info"
              }
            >
              {followUpOverdue ? (
                <AlertCircle className="h-3 w-3" />
              ) : (
                <CalendarClock className="h-3 w-3" />
              )}
              Follow up {shortDate(app.follow_up_on)}
            </Badge>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

// ---------- add / edit dialog ----------

type AppDraft = {
  company: string;
  role: string;
  stage: ApplicationStage;
  jd_url: string | null;
  referral_contact: string | null;
  salary_note: string | null;
  follow_up_on: string | null;
  notes: string | null;
};

function AppDialog({
  open,
  editing,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  editing: JobApplication | null;
  onClose: () => void;
  onSave: (draft: AppDraft) => Promise<void>;
  onDelete: (app: JobApplication) => Promise<void>;
}) {
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [stage, setStage] = useState<ApplicationStage>("wishlist");
  const [jdUrl, setJdUrl] = useState("");
  const [referral, setReferral] = useState("");
  const [salary, setSalary] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setCompany(editing.company);
      setRole(editing.role);
      setStage(editing.stage);
      setJdUrl(editing.jd_url ?? "");
      setReferral(editing.referral_contact ?? "");
      setSalary(editing.salary_note ?? "");
      setFollowUp(editing.follow_up_on ?? "");
      setNotes(editing.notes ?? "");
    } else {
      setCompany("");
      setRole("");
      setStage("wishlist");
      setJdUrl("");
      setReferral("");
      setSalary("");
      setFollowUp("");
      setNotes("");
    }
    setErr(null);
  }, [open, editing]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const c = company.trim();
    const r = role.trim();
    if (!c || !r) {
      setErr("Company and role are required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await onSave({
        company: c,
        role: r,
        stage,
        jd_url: jdUrl.trim() ? jdUrl.trim() : null,
        referral_contact: referral.trim() ? referral.trim() : null,
        salary_note: salary.trim() ? salary.trim() : null,
        follow_up_on: followUp || null,
        notes: notes.trim() ? notes.trim() : null,
      });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not save the application.");
    } finally {
      setSaving(false);
    }
  }

  const jdHref = editing?.jd_url ?? (jdUrl.trim() || null);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? `${editing.company} — ${editing.role}` : "New application"}
      description={
        editing
          ? "Update details, or change the stage (handy on touch devices)."
          : "Each company + role pair can only be tracked once."
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="app-company">Company</Label>
            <Input
              id="app-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Stripe"
              maxLength={120}
              autoFocus={!editing}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="app-role">Role</Label>
            <Input
              id="app-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Senior Frontend Engineer"
              maxLength={120}
              required
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="app-stage">Stage</Label>
          <Select
            id="app-stage"
            value={stage}
            onChange={(e) => setStage(e.target.value as ApplicationStage)}
          >
            {APP_STAGE_ORDER.map((s) => (
              <option key={s} value={s}>
                {APP_STAGE_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="app-jd">Job description URL (optional)</Label>
            {jdHref && (
              <a
                href={jdHref}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Open JD
              </a>
            )}
          </div>
          <Input
            id="app-jd"
            type="url"
            value={jdUrl}
            onChange={(e) => setJdUrl(e.target.value)}
            placeholder="https://…"
            maxLength={500}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="app-referral">Referral contact (optional)</Label>
            <Input
              id="app-referral"
              value={referral}
              onChange={(e) => setReferral(e.target.value)}
              placeholder="Name / handle"
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="app-salary">Salary note (optional)</Label>
            <Input
              id="app-salary"
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              placeholder="e.g. 30–35 LPA band"
              maxLength={200}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="app-followup">Follow up on (optional)</Label>
          <DateField
            id="app-followup"
            value={followUp}
            onChange={setFollowUp}
            quickPicks={false}
          />
          {followUp && (
            <button
              type="button"
              onClick={() => setFollowUp("")}
              className="text-[11px] px-2 py-0.5 rounded-full border border-input text-muted-foreground hover:bg-accent"
            >
              Clear follow-up
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="app-notes">Notes (optional)</Label>
          <Textarea
            id="app-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Interview panel, prep pointers, recruiter details…"
            maxLength={2000}
            rows={3}
          />
        </div>

        {err && (
          <p role="alert" className="text-sm text-destructive">
            {err}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 pt-2">
          {editing ? (
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => void onDelete(editing)}
              disabled={saving}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !company.trim() || !role.trim()}>
              {saving ? "Saving…" : editing ? "Save changes" : "Add application"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
