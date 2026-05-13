import { useCallback, useEffect, useRef, useState } from "react";
import {
  Flame,
  Compass,
  TrendingUp,
  ShieldCheck,
  Quote,
  Sparkles,
  ArrowRight,
  Pencil,
  Check,
  Plus,
  X,
  RotateCcw,
  Globe,
  RefreshCw,
  AlertTriangle,
  Bookmark,
  BookmarkPlus,
  BookmarkCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { cn } from "@/lib/utils";
import { dayOfYear, formatLongDate, ymd } from "@/lib/dates";

// ---------------------------------------------------------------------------
// Content model — everything visible on this page is stored in this single
// object so the user can edit it through the UI and we can persist it as
// one JSON blob in localStorage.
// ---------------------------------------------------------------------------
interface DirectionItem {
  title: string;
  body: string;
}
interface ImprovementItem {
  area: string;
  action: string;
}
interface SayingItem {
  quote: string;
  author: string;
}
/**
 * A user-defined section. The user supplies the title, subtitle and a list of
 * bullet items. Rendered with the same numbered-list look as Principles.
 */
interface CustomSection {
  id: string;
  title: string;
  subtitle: string;
  items: string[];
}
interface MotivationContent {
  mantras: string[];
  lifeDirection: DirectionItem[];
  improvements: ImprovementItem[];
  principles: string[];
  sayings: SayingItem[];
  customSections: CustomSection[];
}

const DEFAULTS: MotivationContent = {
  mantras: [
    "Discipline is the bridge between who you are and who you want to become.",
    "You are one decision away from a different life.",
    "Small steps every day. No zero days.",
    "The only fight you must win is the one against yesterday's version of yourself.",
    "Hard now, easy later. Easy now, hard later.",
  ],
  lifeDirection: [
    {
      title: "Build, don't drift",
      body: "Choose what your days are made of. Drifting is the slow loss of the life you wanted.",
    },
    {
      title: "Health is the foundation",
      body: "Sleep, move, eat clean, hydrate. Without the body, nothing else compounds.",
    },
    {
      title: "Master one craft",
      body: "Go deep before you go wide. Depth pays — not just attendance.",
    },
    {
      title: "Protect your focus",
      body: "Your attention is the most expensive thing you own. Spend it like it matters.",
    },
  ],
  improvements: [
    { area: "Mind", action: "Read 20 minutes. Journal 5. No doomscrolling before 10am." },
    { area: "Body", action: "Train 4x/week. Walk 8k steps. Sleep before midnight." },
    { area: "Money", action: "Track every rupee. Save first, spend what's left." },
    { area: "Skill", action: "Ship one small thing every week. Done > perfect." },
    { area: "People", action: "Reply faster. Show up. Be the friend you wish you had." },
  ],
  principles: [
    "Do the hard thing first.",
    "If it takes less than two minutes, do it now.",
    "Show up — especially when you don't feel like it.",
    "Comparison is a thief. Run your own race.",
    "Be early. Be prepared. Be honest.",
    "What you tolerate, you become.",
    "Don't break the chain. One day at a time.",
  ],
  sayings: [
    { quote: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese proverb" },
    { quote: "Fall seven times, stand up eight.", author: "Japanese proverb" },
    { quote: "A river cuts through rock, not because of its power, but its persistence.", author: "Jim Watkins" },
    { quote: "Whether you think you can or you think you can't — you're right.", author: "Henry Ford" },
    { quote: "We suffer more in imagination than in reality.", author: "Seneca" },
    { quote: "Action is the antidote to despair.", author: "Joan Baez" },
  ],
  customSections: [],
};

const STORAGE_KEY = "motivation:v1";
const ROTATE_MS = 8000;

function loadContent(): MotivationContent {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<MotivationContent>;
    return {
      mantras: parsed.mantras ?? DEFAULTS.mantras,
      lifeDirection: parsed.lifeDirection ?? DEFAULTS.lifeDirection,
      improvements: parsed.improvements ?? DEFAULTS.improvements,
      principles: parsed.principles ?? DEFAULTS.principles,
      sayings: parsed.sayings ?? DEFAULTS.sayings,
      customSections: parsed.customSections ?? DEFAULTS.customSections,
    };
  } catch {
    return DEFAULTS;
  }
}

function saveContent(c: MotivationContent) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* ignore quota / private-mode errors — the in-memory state still works */
  }
}

// ---------------------------------------------------------------------------
// Daily quote — fetched once per day from a public quote API and cached in
// localStorage. Falls back gracefully when offline or the API is down.
// ---------------------------------------------------------------------------
interface DailyQuote {
  quote: string;
  author: string;
  fetchedOn: string; // YYYY-MM-DD (local)
}

const DAILY_QUOTE_KEY = "motivation:dailyQuote:v1";

// We try several free, CORS-enabled public quote APIs in order. The first one
// that returns a usable payload wins. This way a single provider being down
// (SSL expiry, rate limit, etc.) doesn't break the section.
interface QuoteSource {
  name: string;
  url: string;
  parse: (data: unknown) => { content: string; author: string } | null;
}

const QUOTE_SOURCES: QuoteSource[] = [
  {
    name: "dummyjson",
    url: "https://dummyjson.com/quotes/random",
    parse: (data) => {
      const d = data as { quote?: string; author?: string };
      return d?.quote && d?.author ? { content: d.quote, author: d.author } : null;
    },
  },
  {
    name: "zenquotes",
    url: "https://zenquotes.io/api/random",
    parse: (data) => {
      const arr = data as Array<{ q?: string; a?: string }>;
      const first = Array.isArray(arr) ? arr[0] : undefined;
      return first?.q && first?.a ? { content: first.q, author: first.a } : null;
    },
  },
  {
    name: "quotable",
    url: "https://api.quotable.io/random?minLength=40&maxLength=180",
    parse: (data) => {
      const d = data as { content?: string; author?: string };
      return d?.content && d?.author ? { content: d.content, author: d.author } : null;
    },
  },
];

async function fetchQuoteFromAnySource(): Promise<{ content: string; author: string }> {
  const errors: string[] = [];
  for (const src of QUOTE_SOURCES) {
    try {
      const res = await fetch(src.url);
      if (!res.ok) {
        errors.push(`${src.name}: HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as unknown;
      const parsed = src.parse(data);
      if (parsed) return parsed;
      errors.push(`${src.name}: malformed response`);
    } catch (e) {
      errors.push(`${src.name}: ${e instanceof Error ? e.message : "fetch failed"}`);
    }
  }
  throw new Error(`All quote sources failed — ${errors.join("; ")}`);
}

function loadDailyQuote(): DailyQuote | null {
  try {
    const raw = localStorage.getItem(DAILY_QUOTE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DailyQuote>;
    if (!parsed.quote || !parsed.author || !parsed.fetchedOn) return null;
    return parsed as DailyQuote;
  } catch {
    return null;
  }
}

function saveDailyQuote(q: DailyQuote) {
  try {
    localStorage.setItem(DAILY_QUOTE_KEY, JSON.stringify(q));
  } catch {
    /* ignore */
  }
}

function useDailyQuote() {
  const [quote, setQuote] = useState<DailyQuote | null>(loadDailyQuote);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { content, author } = await fetchQuoteFromAnySource();
      const fresh: DailyQuote = { quote: content, author, fetchedOn: ymd() };
      saveDailyQuote(fresh);
      setQuote(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount if we don't already have today's quote cached.
  useEffect(() => {
    if (!quote || quote.fetchedOn !== ymd()) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-rotate every 24 hours: schedule a refresh at the next local midnight
  // so users who keep the tab open overnight still see a fresh quote.
  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      5, // small offset so `ymd()` has definitely ticked over
    );
    const timer = window.setTimeout(() => {
      refresh();
    }, nextMidnight.getTime() - now.getTime());
    return () => window.clearTimeout(timer);
  }, [refresh, quote?.fetchedOn]);

  // Also catch the case where the browser was suspended past midnight — when
  // the tab becomes visible again, check whether the cached quote is stale.
  useEffect(() => {
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        (!quote || quote.fetchedOn !== ymd())
      ) {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh, quote?.fetchedOn, quote]);

  return { quote, loading, error, refresh };
}

// ---------------------------------------------------------------------------
// Saved quotes — a user-curated library built by hitting the "+" button on
// the daily quote card. Stored locally; deduplicated by quote+author.
// ---------------------------------------------------------------------------
interface SavedQuote {
  id: string;
  quote: string;
  author: string;
  savedOn: string; // YYYY-MM-DD
}

const SAVED_QUOTES_KEY = "motivation:savedQuotes:v1";

function loadSavedQuotes(): SavedQuote[] {
  try {
    const raw = localStorage.getItem(SAVED_QUOTES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedQuote[]) : [];
  } catch {
    return [];
  }
}

function persistSavedQuotes(qs: SavedQuote[]) {
  try {
    localStorage.setItem(SAVED_QUOTES_KEY, JSON.stringify(qs));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

function useSavedQuotes() {
  const [saved, setSaved] = useState<SavedQuote[]>(loadSavedQuotes);

  const update = (next: SavedQuote[]) => {
    setSaved(next);
    persistSavedQuotes(next);
  };

  const isSaved = (q: { quote: string; author: string }) =>
    saved.some((s) => s.quote === q.quote && s.author === q.author);

  const add = (q: { quote: string; author: string }) => {
    if (isSaved(q)) return;
    update([
      { id: newSectionId(), quote: q.quote, author: q.author, savedOn: ymd() },
      ...saved,
    ]);
  };

  const remove = (id: string) => update(saved.filter((s) => s.id !== id));

  return { saved, add, remove, isSaved };
}

/**
 * Built-in section keys. Custom sections use their own `id` string instead.
 * The `editing` map is keyed by either — anything missing is treated as false.
 */
type SectionKey = "mantras" | "lifeDirection" | "improvements" | "principles" | "sayings";

function newSectionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function MotivationPage() {
  const [content, setContent] = useState<MotivationContent>(loadContent);
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const daily = useDailyQuote();
  const savedQuotes = useSavedQuotes();
  const firstRender = useRef(true);

  // Persist on every change. Skip the first render so we don't write the
  // unchanged hydrated state back immediately.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    saveContent(content);
  }, [content]);

  const update = <K extends keyof MotivationContent>(key: K, value: MotivationContent[K]) =>
    setContent((c) => ({ ...c, [key]: value }));

  const toggleEdit = (key: SectionKey | string) =>
    setEditing((e) => ({ ...e, [key]: !e[key] }));

  const resetAll = () => {
    if (confirm("Reset all motivation content back to the defaults? Your edits will be lost.")) {
      setContent(DEFAULTS);
    }
  };

  const addCustomSection = () => {
    const id = newSectionId();
    setContent((c) => ({
      ...c,
      customSections: [
        ...c.customSections,
        { id, title: "New section", subtitle: "", items: [] },
      ],
    }));
    // Open the new section in edit mode immediately so the user can fill it in.
    setEditing((e) => ({ ...e, [id]: true }));
  };

  const updateCustomSection = (
    id: string,
    patch: Partial<Omit<CustomSection, "id">>
  ) =>
    setContent((c) => ({
      ...c,
      customSections: c.customSections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));

  const deleteCustomSection = (id: string) => {
    if (!confirm("Delete this section and all its items?")) return;
    setContent((c) => ({
      ...c,
      customSections: c.customSections.filter((s) => s.id !== id),
    }));
    setEditing((e) => {
      const { [id]: _removed, ...rest } = e;
      return rest;
    });
  };

  const mantra =
    content.mantras.length > 0
      ? content.mantras[dayOfYear() % content.mantras.length]
      : "Tap the pencil on the hero to add your first mantra.";

  return (
    <div className="space-y-8">
      <Toolbar onReset={resetAll} />

      <Hero
        mantra={mantra}
        editing={editing.mantras}
        onToggleEdit={() => toggleEdit("mantras")}
      />

      {editing.mantras && (
        <Section
          icon={<Flame className="h-4 w-4" />}
          eyebrow="Daily mantras"
          title="Mantras shown in the hero"
          subtitle="One is picked each day. Keep them short and brutal."
        >
          <StringListEditor
            values={content.mantras}
            onChange={(v) => update("mantras", v)}
            placeholder="A short mantra…"
            multiline
          />
        </Section>
      )}

      <Section
        icon={<Globe className="h-4 w-4" />}
        eyebrow="From the world"
        title="Today's quote"
        subtitle="A fresh quote fetched once every 24 hours. Tap the bookmark to keep it."
      >
        <DailyQuoteCard
          {...daily}
          isSaved={
            daily.quote
              ? savedQuotes.isSaved({
                  quote: daily.quote.quote,
                  author: daily.quote.author,
                })
              : false
          }
          onSave={() => {
            if (daily.quote) {
              savedQuotes.add({
                quote: daily.quote.quote,
                author: daily.quote.author,
              });
            }
          }}
        />
      </Section>

      <Section
        icon={<Bookmark className="h-4 w-4" />}
        eyebrow="Library"
        title="Saved today's quotes"
        subtitle="Quotes you've kept from the daily feed."
      >
        <SavedQuotesView quotes={savedQuotes.saved} onRemove={savedQuotes.remove} />
      </Section>

      <Section
        icon={<Compass className="h-4 w-4" />}
        eyebrow="Life direction"
        title="What I should do with my life"
        subtitle="The compass — read it when the days blur together."
        editing={editing.lifeDirection}
        onToggleEdit={() => toggleEdit("lifeDirection")}
      >
        {editing.lifeDirection ? (
          <DirectionEditor
            values={content.lifeDirection}
            onChange={(v) => update("lifeDirection", v)}
          />
        ) : (
          <DirectionView items={content.lifeDirection} />
        )}
      </Section>

      <Section
        icon={<TrendingUp className="h-4 w-4" />}
        eyebrow="Improvements"
        title="Where I'm growing"
        subtitle="One small step in each lane. Boring beats motivated."
        editing={editing.improvements}
        onToggleEdit={() => toggleEdit("improvements")}
      >
        {editing.improvements ? (
          <ImprovementsEditor
            values={content.improvements}
            onChange={(v) => update("improvements", v)}
          />
        ) : (
          <ImprovementsView items={content.improvements} />
        )}
      </Section>

      <Section
        icon={<ShieldCheck className="h-4 w-4" />}
        eyebrow="Principles"
        title="Points to remember & follow"
        subtitle="Non-negotiables. The rules of the game I picked for myself."
        editing={editing.principles}
        onToggleEdit={() => toggleEdit("principles")}
      >
        {editing.principles ? (
          <StringListEditor
            values={content.principles}
            onChange={(v) => update("principles", v)}
            placeholder="A rule to live by…"
          />
        ) : (
          <PrinciplesView items={content.principles} />
        )}
      </Section>

      <Section
        icon={<Quote className="h-4 w-4" />}
        eyebrow="Sayings"
        title="Words to carry"
        subtitle="A rotating quote. Sit with it for a moment."
        editing={editing.sayings}
        onToggleEdit={() => toggleEdit("sayings")}
      >
        {editing.sayings ? (
          <SayingsEditor values={content.sayings} onChange={(v) => update("sayings", v)} />
        ) : (
          <SayingsView items={content.sayings} />
        )}
      </Section>

      {content.customSections.map((section) => (
        <Section
          key={section.id}
          icon={<Sparkles className="h-4 w-4" />}
          eyebrow="Custom"
          title={section.title || "Untitled section"}
          subtitle={section.subtitle || "Your own list of things to remember."}
          editing={!!editing[section.id]}
          onToggleEdit={() => toggleEdit(section.id)}
        >
          {editing[section.id] ? (
            <CustomSectionEditor
              section={section}
              onChange={(patch) => updateCustomSection(section.id, patch)}
              onDelete={() => deleteCustomSection(section.id)}
            />
          ) : (
            <PrinciplesView items={section.items} />
          )}
        </Section>
      ))}

      <div className="pt-2">
        <Button variant="outline" onClick={addCustomSection}>
          <Plus className="h-4 w-4" /> Add custom section
        </Button>
      </div>

      <ClosingCallout />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function Toolbar({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button variant="ghost" size="sm" onClick={onReset}>
        <RotateCcw className="h-4 w-4" /> Reset to defaults
      </Button>
    </div>
  );
}

/**
 * Small inline pencil/check button that toggles a single section into edit
 * mode. Kept consistent across the hero and every section header.
 */
function EditToggleButton({
  editing,
  onClick,
  label,
}: {
  editing: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant={editing ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      aria-pressed={editing}
      aria-label={editing ? `Done editing ${label}` : `Edit ${label}`}
      className="shrink-0"
    >
      {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
      <span className="hidden sm:inline">{editing ? "Done" : "Edit"}</span>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function Hero({
  mantra,
  editing,
  onToggleEdit,
}: {
  mantra: string;
  editing: boolean;
  onToggleEdit: () => void;
}) {
  const dateLabelRef = useRef(formatLongDate());
  return (
    <div className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/20 via-primary/5 to-card p-8 md:p-12">
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-primary/10 blur-3xl"
        aria-hidden
      />
      <div className="absolute top-4 right-4 z-10">
        <EditToggleButton editing={editing} onClick={onToggleEdit} label="mantras" />
      </div>
      <div className="relative">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
          <Flame className="h-3 w-3" /> Daily mantra · {dateLabelRef.current}
        </div>
        <h1 className="mt-5 max-w-3xl text-3xl md:text-5xl font-black leading-[1.1] tracking-tight text-foreground">
          {mantra}
        </h1>
        <p className="mt-4 max-w-xl text-sm md:text-base text-muted-foreground">
          Read it. Breathe. Then go do the thing you've been avoiding.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section shell
// ---------------------------------------------------------------------------

function Section({
  icon,
  eyebrow,
  title,
  subtitle,
  editing,
  onToggleEdit,
  children,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  subtitle: string;
  editing?: boolean;
  onToggleEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            {eyebrow}
          </p>
          <h2 className="text-xl md:text-2xl font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {onToggleEdit && (
          <EditToggleButton
            editing={!!editing}
            onClick={onToggleEdit}
            label={title.toLowerCase()}
          />
        )}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// View components (read-only)
// ---------------------------------------------------------------------------

function DirectionView({ items }: { items: DirectionItem[] }) {
  if (items.length === 0) return <EmptyHint label="No life-direction notes yet." />;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((item, i) => (
        <Card
          key={`${item.title}-${i}`}
          className="group relative overflow-hidden p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="font-semibold tracking-tight">{item.title || "Untitled"}</h3>
          </div>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{item.body}</p>
          <ArrowRight className="absolute bottom-4 right-4 h-4 w-4 text-primary/0 transition-all group-hover:text-primary group-hover:translate-x-0.5" />
        </Card>
      ))}
    </div>
  );
}

function ImprovementsView({ items }: { items: ImprovementItem[] }) {
  if (items.length === 0) return <EmptyHint label="No improvements yet." />;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((it, i) => (
        <li key={`${it.area}-${i}`}>
          <Card className="group relative overflow-hidden p-4 transition-colors hover:border-primary/40">
            <span className="pointer-events-none absolute -right-6 -top-6 text-6xl font-black tracking-tighter text-primary/5 select-none">
              {String(i + 1).padStart(2, "0")}
            </span>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              {it.area || "—"}
            </p>
            <p className="mt-1.5 text-sm text-foreground/90">{it.action}</p>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function PrinciplesView({ items }: { items: string[] }) {
  if (items.length === 0) return <EmptyHint label="No principles yet." />;
  return (
    <ol className="space-y-2">
      {items.map((p, i) => (
        <li
          key={`${p}-${i}`}
          className="flex items-start gap-4 rounded-lg border border-transparent p-3 transition-colors hover:border-border hover:bg-accent/40"
        >
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-bold text-primary ring-1 ring-primary/20">
            {i + 1}
          </span>
          <p className="text-base font-medium leading-snug text-foreground/95">{p}</p>
        </li>
      ))}
    </ol>
  );
}

function DailyQuoteCard({
  quote,
  loading,
  error,
  refresh,
  isSaved,
  onSave,
}: {
  quote: DailyQuote | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  isSaved: boolean;
  onSave: () => void;
}) {
  return (
    <Card className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-card to-card">
      <CardContent className="relative p-6 md:p-8">
        <Globe
          className="pointer-events-none absolute -right-6 -bottom-6 h-32 w-32 text-primary/10"
          aria-hidden
        />
        <div className="relative flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {loading && !quote ? (
              <DailyQuoteSkeleton />
            ) : error && !quote ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4" /> Couldn't reach the quote service
                </p>
                <p className="text-xs text-muted-foreground">{error}</p>
              </div>
            ) : quote ? (
              <>
                <p className="text-lg md:text-xl font-medium leading-relaxed tracking-tight text-foreground">
                  &ldquo;{quote.quote}&rdquo;
                </p>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-primary">
                  — {quote.author}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Fetched {quote.fetchedOn === ymd() ? "today" : `on ${quote.fetchedOn}`}
                  {error ? " · last refresh failed" : ""}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No quote yet.</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onSave}
              disabled={!quote || isSaved}
              aria-label={isSaved ? "Already saved" : "Save quote"}
              aria-pressed={isSaved}
              title={isSaved ? "Already in your saved quotes" : "Save to today's quotes"}
              className={cn(isSaved && "text-primary")}
            >
              {isSaved ? (
                <BookmarkCheck className="h-4 w-4" />
              ) : (
                <BookmarkPlus className="h-4 w-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={refresh}
              disabled={loading}
              aria-label="Refresh quote"
              title="Refresh now"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SavedQuotesView({
  quotes,
  onRemove,
}: {
  quotes: SavedQuote[];
  onRemove: (id: string) => void;
}) {
  if (quotes.length === 0) {
    return (
      <p className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
        No saved quotes yet. Tap the{" "}
        <BookmarkPlus className="inline h-3.5 w-3.5 align-text-bottom" /> on
        today's quote to keep it here.
      </p>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {quotes.map((q) => (
        <li key={q.id}>
          <Card className="group relative overflow-hidden p-5 transition-colors hover:border-primary/40">
            <Quote
              className="pointer-events-none absolute -right-3 -top-3 h-16 w-16 text-primary/10"
              aria-hidden
            />
            <div className="relative">
              <p className="text-sm md:text-base font-medium leading-relaxed text-foreground">
                &ldquo;{q.quote}&rdquo;
              </p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                  — {q.author}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Saved {q.savedOn}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemove(q.id)}
              aria-label="Remove saved quote"
              title="Remove"
              className="absolute right-2 top-2 h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function DailyQuoteSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <div className="h-5 w-11/12 animate-pulse rounded bg-muted" />
      <div className="h-5 w-9/12 animate-pulse rounded bg-muted" />
      <div className="h-3 w-32 animate-pulse rounded bg-muted mt-4" />
    </div>
  );
}

function SayingsView({ items }: { items: SayingItem[] }) {
  const [idx, setIdx] = useState(0);
  const timerRef = useRef<number | null>(null);

  const startTimer = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    if (items.length <= 1) return;
    timerRef.current = window.setInterval(() => {
      setIdx((i) => (i + 1) % items.length);
    }, ROTATE_MS);
  };

  useEffect(() => {
    setIdx((i) => (items.length === 0 ? 0 : i % items.length));
    startTimer();
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  if (items.length === 0) return <EmptyHint label="No sayings yet." />;
  const saying = items[idx] ?? items[0];

  const handleDotClick = (i: number) => {
    setIdx(i);
    startTimer();
  };

  return (
    <Card className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-card to-card">
      <CardContent className="relative p-8 md:p-12 pt-8 md:pt-12">
        <Quote
          className="pointer-events-none absolute -left-4 -top-4 h-28 w-28 text-primary/10"
          aria-hidden
        />
        <div className="relative">
          <p className="text-xl md:text-2xl font-medium leading-relaxed tracking-tight text-foreground">
            &ldquo;{saying.quote}&rdquo;
          </p>
          <p className="mt-4 text-sm font-semibold uppercase tracking-wider text-primary">
            — {saying.author}
          </p>
        </div>
        {items.length > 1 && (
          <div
            className="relative mt-6 flex flex-wrap gap-1.5"
            role="group"
            aria-label="Saying selector"
          >
            {items.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleDotClick(i)}
                aria-label={`Show saying ${i + 1}`}
                aria-current={i === idx ? "true" : undefined}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                  i === idx ? "w-8 bg-primary" : "w-3 bg-muted hover:bg-muted-foreground/40"
                )}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Edit components
// ---------------------------------------------------------------------------

function StringListEditor({
  values,
  onChange,
  placeholder,
  multiline,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  const update = (i: number, v: string) => {
    const next = values.slice();
    next[i] = v;
    onChange(next);
  };
  const remove = (i: number) => onChange(values.filter((_, j) => j !== i));
  const add = () => onChange([...values, ""]);

  return (
    <div className="space-y-2">
      {values.map((v, i) => (
        <div key={i} className="flex items-start gap-2">
          {multiline ? (
            <Textarea
              value={v}
              onChange={(e) => update(i, e.target.value)}
              placeholder={placeholder}
              className="min-h-[60px]"
            />
          ) : (
            <Input value={v} onChange={(e) => update(i, e.target.value)} placeholder={placeholder} />
          )}
          <RemoveButton onClick={() => remove(i)} />
        </div>
      ))}
      <AddButton onClick={add} label="Add" />
    </div>
  );
}

function DirectionEditor({
  values,
  onChange,
}: {
  values: DirectionItem[];
  onChange: (next: DirectionItem[]) => void;
}) {
  const update = (i: number, patch: Partial<DirectionItem>) => {
    const next = values.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => onChange(values.filter((_, j) => j !== i));
  const add = () => onChange([...values, { title: "", body: "" }]);

  return (
    <div className="space-y-3">
      {values.map((it, i) => (
        <Card key={i} className="p-4">
          <div className="flex items-start gap-2">
            <div className="flex-1 space-y-2">
              <Input
                value={it.title}
                onChange={(e) => update(i, { title: e.target.value })}
                placeholder="Title (e.g. Build, don't drift)"
              />
              <Textarea
                value={it.body}
                onChange={(e) => update(i, { body: e.target.value })}
                placeholder="One or two sentences explaining the direction…"
                className="min-h-[60px]"
              />
            </div>
            <RemoveButton onClick={() => remove(i)} />
          </div>
        </Card>
      ))}
      <AddButton onClick={add} label="Add direction" />
    </div>
  );
}

function ImprovementsEditor({
  values,
  onChange,
}: {
  values: ImprovementItem[];
  onChange: (next: ImprovementItem[]) => void;
}) {
  const update = (i: number, patch: Partial<ImprovementItem>) => {
    const next = values.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => onChange(values.filter((_, j) => j !== i));
  const add = () => onChange([...values, { area: "", action: "" }]);

  return (
    <div className="space-y-2">
      {values.map((it, i) => (
        <div key={i} className="flex items-start gap-2">
          <Input
            value={it.area}
            onChange={(e) => update(i, { area: e.target.value })}
            placeholder="Area (e.g. Mind)"
            className="sm:max-w-[180px]"
          />
          <Input
            value={it.action}
            onChange={(e) => update(i, { action: e.target.value })}
            placeholder="What you'll do…"
          />
          <RemoveButton onClick={() => remove(i)} />
        </div>
      ))}
      <AddButton onClick={add} label="Add improvement" />
    </div>
  );
}

function SayingsEditor({
  values,
  onChange,
}: {
  values: SayingItem[];
  onChange: (next: SayingItem[]) => void;
}) {
  const update = (i: number, patch: Partial<SayingItem>) => {
    const next = values.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => onChange(values.filter((_, j) => j !== i));
  const add = () => onChange([...values, { quote: "", author: "" }]);

  return (
    <div className="space-y-3">
      {values.map((it, i) => (
        <Card key={i} className="p-4">
          <div className="flex items-start gap-2">
            <div className="flex-1 space-y-2">
              <Textarea
                value={it.quote}
                onChange={(e) => update(i, { quote: e.target.value })}
                placeholder="The quote…"
                className="min-h-[60px]"
              />
              <Input
                value={it.author}
                onChange={(e) => update(i, { author: e.target.value })}
                placeholder="Author or source"
              />
            </div>
            <RemoveButton onClick={() => remove(i)} />
          </div>
        </Card>
      ))}
      <AddButton onClick={add} label="Add saying" />
    </div>
  );
}

function CustomSectionEditor({
  section,
  onChange,
  onDelete,
}: {
  section: CustomSection;
  onChange: (patch: Partial<Omit<CustomSection, "id">>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          value={section.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Section title (e.g. Books to read)"
          aria-label="Section title"
        />
        <Input
          value={section.subtitle}
          onChange={(e) => onChange({ subtitle: e.target.value })}
          placeholder="Short description (optional)"
          aria-label="Section subtitle"
        />
      </div>
      <StringListEditor
        values={section.items}
        onChange={(v) => onChange({ items: v })}
        placeholder="An item…"
      />
      <div className="flex justify-end border-t pt-3">
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <X className="h-4 w-4" /> Delete section
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit primitives
// ---------------------------------------------------------------------------

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      aria-label="Remove"
      className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
    >
      <X className="h-4 w-4" />
    </Button>
  );
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      <Plus className="h-4 w-4" /> {label}
    </Button>
  );
}

function EmptyHint({ label }: { label: string }) {
  return (
    <p className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
      {label} Tap the <span className="font-medium text-foreground">pencil</span> above to add some.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Closing callout
// ---------------------------------------------------------------------------

function ClosingCallout() {
  return (
    <div className="rounded-2xl border border-dashed border-primary/40 bg-primary/[0.04] p-6 text-center">
      <p className="text-lg font-semibold tracking-tight">
        You closed this page. Now what?
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick <span className="font-medium text-foreground">one</span> thing from above and do it in the next 10 minutes.
      </p>
    </div>
  );
}
