import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Settings,
  Tag,
  CircleDot,
  ListChecks,
  Check,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { slugify, DEFAULT_STATUSES } from "@/lib/todo-config";
import type {
  TodoCategory,
  TodoCustomField,
  TodoCustomFieldType,
  TodoSpace,
  TodoStatus,
} from "@/types";

const DEFAULT_COLOR = "#3b82f6";

/** Assign unique keys derived from labels; blank labels get a positional
 *  fallback and collisions get a numeric suffix so nothing overwrites. */
function withUniqueKeys<T extends { label: string }>(
  rows: T[],
  prefix: string
): (T & { key: string })[] {
  const seen = new Set<string>();
  return rows.map((r, i) => {
    let base = slugify(r.label) || `${prefix}_${i + 1}`;
    let key = base;
    let n = 2;
    while (seen.has(key)) key = `${base}_${n++}`;
    seen.add(key);
    return { ...r, key };
  });
}

export function TodoSpaceSettingsPage() {
  const { user } = useAuth();
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const isInbox = spaceId === "inbox";

  const [space, setSpace] = useState<TodoSpace | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    // The Inbox is virtual — it has no todo_spaces row to configure.
    if (isInbox) {
      navigate("/todos", { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setNotFound(false);
      const { data, error: err } = await supabase
        .from("todo_spaces")
        .select("*")
        .eq("id", spaceId)
        .maybeSingle();
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      if (!data) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setSpace(data as TodoSpace);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, spaceId, isInbox, navigate]);

  if (isInbox) return null;

  if (notFound) {
    return (
      <div className="space-y-4">
        <Link
          to="/todos"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to spaces
        </Link>
        <EmptyState
          icon={<Settings className="h-7 w-7" />}
          title="Space not found"
          description="This space may have been deleted."
          action={
            <Link to="/todos">
              <Button>Back to spaces</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to={`/todos/${spaceId}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to {space?.name ?? "space"}
      </Link>
      <PageHeader
        title={space ? `${space.name} settings` : "Space settings"}
        icon={<Settings className="h-5 w-5" />}
        description="Configure categories, statuses, and custom fields for this space's tickets."
      />

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {loading || !space ? (
        <SkeletonList rows={4} />
      ) : (
        <>
          <CategoriesSection space={space} onSaved={setSpace} />
          <StatusesSection space={space} onSaved={setSpace} />
          <CustomFieldsSection space={space} onSaved={setSpace} />
        </>
      )}
    </div>
  );
}

// ---------- generic section shell ----------

function SectionCard({
  icon,
  title,
  description,
  children,
  footer,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        {children}
        {footer}
      </CardContent>
    </Card>
  );
}

/** Save button + inline success / error note shared by every section. */
function SaveRow({
  onSave,
  saving,
  saved,
  err,
  onAdd,
  addLabel,
}: {
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  err: string | null;
  onAdd: () => void;
  addLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
      <Button type="button" variant="outline" size="sm" onClick={onAdd} disabled={saving}>
        <Plus className="h-4 w-4" /> {addLabel}
      </Button>
      <div className="flex items-center gap-3">
        {err && (
          <span role="alert" className="text-xs text-destructive">
            {err}
          </span>
        )}
        {saved && !err && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        )}
        <Button type="button" size="sm" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

/** Persist one JSONB column of the space; returns the fresh row on success. */
async function saveColumn(
  spaceId: string,
  patch: Partial<Pick<TodoSpace, "categories" | "statuses" | "custom_fields">>
): Promise<TodoSpace> {
  const { data, error } = await supabase
    .from("todo_spaces")
    .update(patch)
    .eq("id", spaceId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as TodoSpace;
}

// ---------- categories ----------

type CatRow = { label: string; color: string; shortcut: string };

function CategoriesSection({
  space,
  onSaved,
}: {
  space: TodoSpace;
  onSaved: (s: TodoSpace) => void;
}) {
  const [rows, setRows] = useState<CatRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRows(
      (space.categories ?? []).map((c) => ({
        label: c.label,
        color: c.color || DEFAULT_COLOR,
        shortcut: c.shortcut ?? "",
      }))
    );
  }, [space.categories]);

  function update(i: number, patch: Partial<CatRow>) {
    setSaved(false);
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function add() {
    setSaved(false);
    setRows((rs) => [...rs, { label: "", color: DEFAULT_COLOR, shortcut: "" }]);
  }
  function remove(i: number) {
    setSaved(false);
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }

  async function save() {
    const cleaned = rows.map((r) => ({ ...r, label: r.label.trim() }));
    if (cleaned.some((r) => !r.label)) {
      setErr("Every category needs a label.");
      return;
    }
    const keyed = withUniqueKeys(cleaned, "category");
    const payload: TodoCategory[] = keyed.map((r) => ({
      key: r.key,
      label: r.label,
      color: r.color,
      shortcut: r.shortcut.trim() ? r.shortcut.trim().slice(0, 1) : null,
    }));
    setSaving(true);
    setErr(null);
    try {
      const fresh = await saveColumn(space.id, { categories: payload });
      onSaved(fresh);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      icon={<Tag className="h-4 w-4" />}
      title="Categories"
      description="Colour-coded labels for tickets. The key is derived from the label."
      footer={
        <SaveRow
          onSave={save}
          saving={saving}
          saved={saved}
          err={err}
          onAdd={add}
          addLabel="Add category"
        />
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No categories yet. Add one below.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li
              key={i}
              className="flex items-end gap-2 rounded-lg border border-border/60 bg-background/50 p-2 flex-wrap sm:flex-nowrap"
            >
              <input
                type="color"
                aria-label={`Colour for category ${i + 1}`}
                value={r.color}
                onChange={(e) => update(i, { color: e.target.value })}
                className="h-10 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5"
              />
              <div className="flex-1 min-w-[8rem] space-y-1">
                <Label className="text-[11px] text-muted-foreground">Label</Label>
                <Input
                  value={r.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                  placeholder="e.g. Bug"
                  maxLength={40}
                />
                <p className="text-[10px] text-muted-foreground font-mono">
                  {slugify(r.label) || "—"}
                </p>
              </div>
              <div className="w-16 space-y-1">
                <Label className="text-[11px] text-muted-foreground">Key</Label>
                <Input
                  value={r.shortcut}
                  onChange={(e) => update(i, { shortcut: e.target.value })}
                  placeholder="⌨"
                  maxLength={1}
                  title="Optional single-char shortcut (Alt+key)"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0 hover:text-destructive"
                aria-label={`Delete category ${i + 1}`}
                onClick={() => remove(i)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------- statuses ----------

type StatusRow = { label: string; color: string; icon: string; done: boolean };

function StatusesSection({
  space,
  onSaved,
}: {
  space: TodoSpace;
  onSaved: (s: TodoSpace) => void;
}) {
  const [rows, setRows] = useState<StatusRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const source = space.statuses?.length ? space.statuses : DEFAULT_STATUSES;
    setRows(
      source.map((s) => ({
        label: s.label,
        color: s.color || DEFAULT_COLOR,
        icon: s.icon ?? "",
        done: !!s.done,
      }))
    );
  }, [space.statuses]);

  function update(i: number, patch: Partial<StatusRow>) {
    setSaved(false);
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function add() {
    setSaved(false);
    setRows((rs) => [...rs, { label: "", color: DEFAULT_COLOR, icon: "", done: false }]);
  }
  function remove(i: number) {
    setSaved(false);
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }

  async function save() {
    const cleaned = rows.map((r) => ({ ...r, label: r.label.trim() }));
    if (cleaned.length === 0) {
      setErr("Keep at least one status.");
      return;
    }
    if (cleaned.some((r) => !r.label)) {
      setErr("Every status needs a label.");
      return;
    }
    const keyed = withUniqueKeys(cleaned, "status");
    const payload: TodoStatus[] = keyed.map((r) => ({
      key: r.key,
      label: r.label,
      color: r.color,
      icon: r.icon.trim() ? r.icon.trim().slice(0, 2) : null,
      done: r.done,
    }));
    setSaving(true);
    setErr(null);
    try {
      const fresh = await saveColumn(space.id, { statuses: payload });
      onSaved(fresh);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      icon={<CircleDot className="h-4 w-4" />}
      title="Statuses"
      description="Workflow states. 'Counts as done' keeps the ticket's completion in sync."
      footer={
        <SaveRow
          onSave={save}
          saving={saving}
          saved={saved}
          err={err}
          onAdd={add}
          addLabel="Add status"
        />
      }
    >
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li
            key={i}
            className="flex items-end gap-2 rounded-lg border border-border/60 bg-background/50 p-2 flex-wrap sm:flex-nowrap"
          >
            <input
              type="color"
              aria-label={`Colour for status ${i + 1}`}
              value={r.color}
              onChange={(e) => update(i, { color: e.target.value })}
              className="h-10 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5"
            />
            <div className="flex-1 min-w-[8rem] space-y-1">
              <Label className="text-[11px] text-muted-foreground">Label</Label>
              <Input
                value={r.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="e.g. In review"
                maxLength={40}
              />
              <p className="text-[10px] text-muted-foreground font-mono">
                {slugify(r.label) || "—"}
              </p>
            </div>
            <div className="w-16 space-y-1">
              <Label className="text-[11px] text-muted-foreground">Icon</Label>
              <Input
                value={r.icon}
                onChange={(e) => update(i, { icon: e.target.value })}
                placeholder="🚧"
                maxLength={2}
                title="Optional emoji / short glyph"
              />
            </div>
            <label className="flex items-center gap-1.5 h-10 shrink-0 text-xs text-muted-foreground cursor-pointer select-none px-1">
              <input
                type="checkbox"
                checked={r.done}
                onChange={(e) => update(i, { done: e.target.checked })}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Done
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 hover:text-destructive"
              aria-label={`Delete status ${i + 1}`}
              onClick={() => remove(i)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

// ---------- custom fields ----------

type FieldRow = { label: string; type: TodoCustomFieldType; required: boolean };

function CustomFieldsSection({
  space,
  onSaved,
}: {
  space: TodoSpace;
  onSaved: (s: TodoSpace) => void;
}) {
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRows(
      (space.custom_fields ?? []).map((f) => ({
        label: f.label,
        type: f.type,
        required: !!f.required,
      }))
    );
  }, [space.custom_fields]);

  function update(i: number, patch: Partial<FieldRow>) {
    setSaved(false);
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function add() {
    setSaved(false);
    setRows((rs) => [...rs, { label: "", type: "text", required: false }]);
  }
  function remove(i: number) {
    setSaved(false);
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }

  async function save() {
    const cleaned = rows.map((r) => ({ ...r, label: r.label.trim() }));
    if (cleaned.some((r) => !r.label)) {
      setErr("Every field needs a label.");
      return;
    }
    const keyed = withUniqueKeys(cleaned, "field");
    const payload: TodoCustomField[] = keyed.map((r) => ({
      key: r.key,
      label: r.label,
      type: r.type,
      required: r.required,
    }));
    setSaving(true);
    setErr(null);
    try {
      const fresh = await saveColumn(space.id, { custom_fields: payload });
      onSaved(fresh);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      icon={<ListChecks className="h-4 w-4" />}
      title="Custom fields"
      description="Extra fields captured on every ticket in this space."
      footer={
        <SaveRow
          onSave={save}
          saving={saving}
          saved={saved}
          err={err}
          onAdd={add}
          addLabel="Add field"
        />
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No custom fields yet. Add one below.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li
              key={i}
              className="flex items-end gap-2 rounded-lg border border-border/60 bg-background/50 p-2 flex-wrap sm:flex-nowrap"
            >
              <div className="flex-1 min-w-[8rem] space-y-1">
                <Label className="text-[11px] text-muted-foreground">Label</Label>
                <Input
                  value={r.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                  placeholder="e.g. Story points"
                  maxLength={40}
                />
                <p className="text-[10px] text-muted-foreground font-mono">
                  {slugify(r.label) || "—"}
                </p>
              </div>
              <div className="w-28 space-y-1">
                <Label className="text-[11px] text-muted-foreground">Type</Label>
                <Select
                  value={r.type}
                  onChange={(e) => update(i, { type: e.target.value as TodoCustomFieldType })}
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                </Select>
              </div>
              <label className="flex items-center gap-1.5 h-10 shrink-0 text-xs text-muted-foreground cursor-pointer select-none px-1">
                <input
                  type="checkbox"
                  checked={r.required}
                  onChange={(e) => update(i, { required: e.target.checked })}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                Required
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0 hover:text-destructive"
                aria-label={`Delete field ${i + 1}`}
                onClick={() => remove(i)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
