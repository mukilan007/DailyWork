import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  Vault,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Dialog } from "@/components/ui/Dialog";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import {
  EMPTY_STAR,
  isUniqueViolation,
  parseStar,
  serializeStar,
  VAULT_KIND_LABELS,
  VAULT_KIND_ORDER,
  type StarSections,
} from "@/lib/prep";
import type { VaultNote, VaultNoteKind } from "@/types";
import { cn } from "@/lib/utils";

type KindFilter = "all" | VaultNoteKind;

const KIND_BADGE: Record<VaultNoteKind, "default" | "info" | "warning" | "secondary"> = {
  star_story: "default",
  achievement: "warning",
  resume_note: "info",
  general: "secondary",
};

export function PrepVaultPage() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<VaultNote | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error: err } = await supabase
        .from("vault_notes")
        .select("*")
        .order("updated_at", { ascending: false });
      if (cancelled) return;
      if (err) setError(err.message);
      else setNotes((data as VaultNote[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handleSave(draft: NoteDraft): Promise<void> {
    if (!user) return;
    setError(null);
    const friendlyDup = () =>
      new Error(
        `A ${VAULT_KIND_LABELS[draft.kind].toLowerCase()} titled "${draft.title}" already exists.`
      );
    if (editing) {
      const prev = notes;
      setNotes((ns) => ns.map((n) => (n.id === editing.id ? { ...n, ...draft } : n)));
      const { data, error: err } = await supabase
        .from("vault_notes")
        .update(draft)
        .eq("id", editing.id)
        .select()
        .single();
      if (err) {
        setNotes(prev);
        if (isUniqueViolation(err)) throw friendlyDup();
        setError(err.message);
        return;
      }
      if (data) {
        setNotes((ns) =>
          ns.map((n) => (n.id === (data as VaultNote).id ? (data as VaultNote) : n))
        );
      }
    } else {
      const { data, error: err } = await supabase
        .from("vault_notes")
        .insert({ user_id: user.id, ...draft })
        .select()
        .single();
      if (err) {
        if (isUniqueViolation(err)) throw friendlyDup();
        setError(err.message);
        return;
      }
      if (data) setNotes((ns) => [data as VaultNote, ...ns]);
    }
    setDialogOpen(false);
    setEditing(null);
  }

  async function handleDelete(note: VaultNote) {
    if (!confirm(`Delete "${note.title}"?`)) return;
    const prev = notes;
    setNotes((ns) => ns.filter((n) => n.id !== note.id));
    const { error: err } = await supabase
      .from("vault_notes")
      .delete()
      .eq("id", note.id);
    if (err) {
      setNotes(prev);
      setError(err.message);
    }
  }

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) for (const t of n.tags ?? []) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [notes]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notes.filter((n) => {
      if (kindFilter !== "all" && n.kind !== kindFilter) return false;
      if (tagFilter && !(n.tags ?? []).includes(tagFilter)) return false;
      if (q && !n.title.toLowerCase().includes(q) && !n.body.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [notes, kindFilter, tagFilter, search]);

  const counts = useMemo(() => {
    const map: Record<KindFilter, number> = {
      all: notes.length,
      star_story: 0,
      achievement: 0,
      resume_note: 0,
      general: 0,
    };
    for (const n of notes) map[n.kind] += 1;
    return map;
  }, [notes]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vault"
        icon={<Vault className="h-5 w-5" />}
        description={
          notes.length === 0
            ? "STAR stories, achievements, and resume notes — ready to paste anywhere."
            : `${notes.length} note${notes.length === 1 ? "" : "s"} in the vault.`
        }
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            disabled={loading}
          >
            <Plus className="h-4 w-4" /> Add note
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

      {/* Kind filter chips + search */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap" role="tablist" aria-label="Filter by kind">
          {(["all", ...VAULT_KIND_ORDER] as KindFilter[]).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kindFilter === k}
              onClick={() => setKindFilter(k)}
              className={cn(
                "inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-all active:scale-95",
                kindFilter === k
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "border-input hover:bg-accent hover:border-accent-foreground/20"
              )}
            >
              <span>{k === "all" ? "All" : VAULT_KIND_LABELS[k]}</span>
              <span
                className={cn(
                  "tabular-nums text-[10px] rounded-full px-1.5 py-0 leading-relaxed",
                  kindFilter === k
                    ? "bg-primary-foreground/20"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {counts[k]}
              </span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or body…"
            className="pl-9"
            aria-label="Search notes"
          />
        </div>
      </div>

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Tag className="h-3.5 w-3.5 text-muted-foreground" />
          {allTags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTagFilter((cur) => (cur === t ? null : t))}
              aria-pressed={tagFilter === t}
              className={cn(
                "text-[11px] px-2.5 py-1 rounded-full border transition-colors",
                tagFilter === t
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-input text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              #{t}
            </button>
          ))}
          {tagFilter && (
            <button
              type="button"
              onClick={() => setTagFilter(null)}
              className="text-[11px] text-primary hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {loading ? (
        <SkeletonList rows={3} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Vault className="h-7 w-7" />}
          title={notes.length === 0 ? "The vault is empty" : "No matching notes"}
          description={
            notes.length === 0
              ? "Store STAR stories and achievements once, reuse them in every interview."
              : "Try a different filter, tag, or search term."
          }
          action={
            notes.length === 0 ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> Add note
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {visible.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              onEdit={() => {
                setEditing(n);
                setDialogOpen(true);
              }}
              onDelete={() => void handleDelete(n)}
              onPickTag={(t) => setTagFilter(t)}
            />
          ))}
        </ul>
      )}

      <NoteDialog
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

// ---------- note card ----------

function NoteCard({
  note,
  onEdit,
  onDelete,
  onPickTag,
}: {
  note: VaultNote;
  onEdit: () => void;
  onDelete: () => void;
  onPickTag: (tag: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${note.title}\n\n${note.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (permissions/insecure context) — ignore.
    }
  }

  return (
    <li>
      <Card className="group h-full transition-shadow hover:shadow-sm">
        <CardContent className="p-4 flex flex-col h-full gap-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-medium leading-snug">{note.title}</h3>
            <div className="flex items-center gap-1 shrink-0 -mt-1 -mr-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={copied ? "Copied" : `Copy ${note.title}`}
                title="Copy to clipboard"
                onClick={() => void copy()}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                aria-label={`Edit ${note.title}`}
                onClick={onEdit}
              >
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:text-destructive"
                aria-label={`Delete ${note.title}`}
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4 flex-1">
            {note.body}
          </p>

          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            <Badge variant={KIND_BADGE[note.kind]}>{VAULT_KIND_LABELS[note.kind]}</Badge>
            {(note.tags ?? []).map((t) => (
              <button key={t} type="button" onClick={() => onPickTag(t)}>
                <Badge variant="outline" className="hover:bg-accent cursor-pointer">
                  #{t}
                </Badge>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

// ---------- add / edit dialog ----------

type NoteDraft = {
  kind: VaultNoteKind;
  title: string;
  body: string;
  tags: string[];
};

const STAR_FIELDS: Array<{ key: keyof StarSections; label: string; placeholder: string }> = [
  { key: "situation", label: "Situation", placeholder: "Context — where, when, what was at stake…" },
  { key: "task", label: "Task", placeholder: "Your responsibility or goal…" },
  { key: "action", label: "Action", placeholder: "What you actually did, step by step…" },
  { key: "result", label: "Result", placeholder: "Outcome with numbers if possible…" },
];

function NoteDialog({
  open,
  editing,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: VaultNote | null;
  onClose: () => void;
  onSave: (draft: NoteDraft) => Promise<void>;
}) {
  const [kind, setKind] = useState<VaultNoteKind>("star_story");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [star, setStar] = useState<StarSections>(EMPTY_STAR);
  const [tagsInput, setTagsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setKind(editing.kind);
      setTitle(editing.title);
      setBody(editing.body);
      setStar(editing.kind === "star_story" ? parseStar(editing.body) : EMPTY_STAR);
      setTagsInput((editing.tags ?? []).join(", "));
    } else {
      setKind("star_story");
      setTitle("");
      setBody("");
      setStar(EMPTY_STAR);
      setTagsInput("");
    }
    setErr(null);
  }, [open, editing]);

  /** Keep content when toggling kind: STAR ↔ plain body via (de)serialisation. */
  function switchKind(next: VaultNoteKind) {
    if (next === kind) return;
    if (next === "star_story" && kind !== "star_story") {
      setStar(body.trim() ? parseStar(body) : EMPTY_STAR);
    } else if (kind === "star_story" && next !== "star_story") {
      const hasContent = Object.values(star).some((s) => s.trim());
      if (hasContent) setBody(serializeStar(star));
    }
    setKind(next);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      setErr("Title is required.");
      return;
    }
    const finalBody = kind === "star_story" ? serializeStar(star) : body.trim();
    const tags = [
      ...new Set(
        tagsInput
          .split(",")
          .map((s) => s.trim().replace(/^#/, ""))
          .filter(Boolean)
      ),
    ];
    setSaving(true);
    setErr(null);
    try {
      await onSave({ kind, title: t, body: finalBody, tags });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not save the note.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Edit note" : "New note"}
      description={
        kind === "star_story"
          ? "STAR stories save as structured markdown you can paste anywhere."
          : "Titles are unique within each kind."
      }
      className="max-w-xl"
    >
      <form onSubmit={onSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        <div className="grid grid-cols-1 sm:grid-cols-[180px,1fr] gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="vn-kind">Kind</Label>
            <Select
              id="vn-kind"
              value={kind}
              onChange={(e) => switchKind(e.target.value as VaultNoteKind)}
            >
              {VAULT_KIND_ORDER.map((k) => (
                <option key={k} value={k}>
                  {VAULT_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vn-title">Title</Label>
            <Input
              id="vn-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                kind === "star_story"
                  ? "e.g. Migrated billing under deadline"
                  : "Short, memorable title"
              }
              maxLength={200}
              autoFocus
              required
            />
          </div>
        </div>

        {kind === "star_story" ? (
          <div className="space-y-3">
            {STAR_FIELDS.map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`vn-star-${key}`}>{label}</Label>
                <Textarea
                  id={`vn-star-${key}`}
                  value={star[key]}
                  onChange={(e) => setStar((s) => ({ ...s, [key]: e.target.value }))}
                  placeholder={placeholder}
                  maxLength={4000}
                  rows={2}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="vn-body">Body</Label>
            <Textarea
              id="vn-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write it once, reuse it everywhere…"
              maxLength={8000}
              rows={7}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="vn-tags">Tags (comma-separated, optional)</Label>
          <Input
            id="vn-tags"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="e.g. leadership, migration, conflict"
            maxLength={300}
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
          <Button type="submit" disabled={saving || !title.trim()}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add note"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
