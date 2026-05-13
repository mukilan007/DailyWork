import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Smile, Search, X } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

/**
 * Small, curated emoji picker — no external dependency.
 * Each entry has keywords so the search box can find it.
 */
type EmojiEntry = { char: string; keywords: string };
type Category = { name: string; emojis: EmojiEntry[] };

const CATEGORIES: Category[] = [
  {
    name: "Activity",
    emojis: [
      { char: "🏃", keywords: "run running jog cardio" },
      { char: "🚶", keywords: "walk walking steps" },
      { char: "🧘", keywords: "yoga meditate meditation calm" },
      { char: "🏋️", keywords: "gym lift weights workout" },
      { char: "🚴", keywords: "bike cycle cycling" },
      { char: "🏊", keywords: "swim swimming pool" },
      { char: "⚽", keywords: "soccer football sport" },
      { char: "🏀", keywords: "basketball sport" },
      { char: "🎾", keywords: "tennis sport" },
      { char: "🏸", keywords: "badminton sport" },
      { char: "🥊", keywords: "boxing fight" },
      { char: "🤸", keywords: "stretch flexibility" },
    ],
  },
  {
    name: "Health",
    emojis: [
      { char: "💧", keywords: "water drink hydrate" },
      { char: "🥗", keywords: "salad healthy food eat" },
      { char: "🍎", keywords: "apple fruit healthy" },
      { char: "🥦", keywords: "broccoli vegetable" },
      { char: "🥛", keywords: "milk drink" },
      { char: "🍵", keywords: "tea herbal" },
      { char: "💊", keywords: "pill medicine vitamin" },
      { char: "🩺", keywords: "doctor health check" },
      { char: "🧴", keywords: "skincare lotion" },
      { char: "🦷", keywords: "tooth dental brush" },
      { char: "💤", keywords: "sleep rest nap" },
      { char: "🛌", keywords: "bed sleep rest" },
    ],
  },
  {
    name: "Mind",
    emojis: [
      { char: "📚", keywords: "books read learning study" },
      { char: "📖", keywords: "book read" },
      { char: "✍️", keywords: "write journal writing" },
      { char: "📝", keywords: "notes writing memo" },
      { char: "🎯", keywords: "target goal focus" },
      { char: "🧠", keywords: "brain mind think" },
      { char: "💡", keywords: "idea bulb think" },
      { char: "📓", keywords: "journal notebook" },
      { char: "🔖", keywords: "bookmark" },
      { char: "🎓", keywords: "study graduate learn" },
      { char: "🌱", keywords: "growth plant grow" },
      { char: "🧩", keywords: "puzzle solve" },
    ],
  },
  {
    name: "Work",
    emojis: [
      { char: "💼", keywords: "work briefcase office" },
      { char: "💻", keywords: "code laptop computer" },
      { char: "🖥️", keywords: "desktop computer" },
      { char: "📊", keywords: "chart analytics data" },
      { char: "📈", keywords: "growth chart up" },
      { char: "📅", keywords: "calendar schedule" },
      { char: "⏰", keywords: "alarm time clock" },
      { char: "✅", keywords: "check done complete" },
      { char: "📞", keywords: "call phone" },
      { char: "✉️", keywords: "email mail message" },
      { char: "🗂️", keywords: "files organize" },
      { char: "🛠️", keywords: "tools build" },
    ],
  },
  {
    name: "Home",
    emojis: [
      { char: "🏠", keywords: "home house" },
      { char: "🧹", keywords: "clean sweep broom" },
      { char: "🧺", keywords: "laundry basket" },
      { char: "🍳", keywords: "cook breakfast egg" },
      { char: "🍲", keywords: "cook meal food" },
      { char: "🛒", keywords: "shop groceries cart" },
      { char: "🪴", keywords: "plant garden" },
      { char: "🐶", keywords: "dog pet walk" },
      { char: "🐱", keywords: "cat pet" },
      { char: "🎵", keywords: "music song play" },
      { char: "🎨", keywords: "art paint create" },
      { char: "📷", keywords: "photo camera" },
    ],
  },
  {
    name: "Mood",
    emojis: [
      { char: "😀", keywords: "happy smile" },
      { char: "🙂", keywords: "ok fine" },
      { char: "😌", keywords: "calm relaxed" },
      { char: "🥰", keywords: "love grateful" },
      { char: "😴", keywords: "sleep tired" },
      { char: "🔥", keywords: "fire streak hot" },
      { char: "⭐", keywords: "star favorite" },
      { char: "❤️", keywords: "heart love" },
      { char: "✨", keywords: "sparkle magic" },
      { char: "🌟", keywords: "star glow" },
      { char: "💪", keywords: "strong muscle" },
      { char: "🙏", keywords: "gratitude thanks pray" },
    ],
  },
];

const ALL_EMOJIS: EmojiEntry[] = CATEGORIES.flatMap((c) => c.emojis);

interface EmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  /** Optional id to associate the trigger button with a label. */
  id?: string;
  /** Placeholder shown when no emoji is selected. */
  placeholder?: string;
  className?: string;
}

export function EmojiPicker({ value, onChange, id, placeholder = "Pick", className }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Reset query when closed
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return ALL_EMOJIS.filter(
      (e) => e.char === q || e.keywords.toLowerCase().includes(q)
    );
  }, [query]);

  const pick = useCallback(
    (char: string) => {
      onChange(char);
      setOpen(false);
    },
    [onChange]
  );

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background pl-3 pr-1 text-sm",
          "transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
          "hover:bg-accent/50"
        )}
      >
        <button
          type="button"
          id={id}
          aria-label={value ? `Selected emoji ${value}, change` : "Pick an emoji"}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-2 bg-transparent text-left focus:outline-none"
        >
          {value ? (
            <span className="text-lg leading-none">{value}</span>
          ) : (
            <Smile className="h-4 w-4 text-muted-foreground" />
          )}
          <span className={cn("flex-1 truncate", !value && "text-muted-foreground")}>
            {value || placeholder}
          </span>
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear emoji"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div
          role="dialog"
          aria-label="Emoji picker"
          className={cn(
            "absolute z-50 mt-1 w-[20rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card text-card-foreground shadow-lg",
            "left-0"
          )}
        >
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search emoji…"
                className="pl-8 h-8"
                autoFocus
              />
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto p-2 space-y-3">
            {filtered ? (
              <Section
                title={`Results (${filtered.length})`}
                emojis={filtered}
                onPick={pick}
                selected={value}
                emptyHint="No emoji matches that search."
              />
            ) : (
              CATEGORIES.map((cat) => (
                <Section
                  key={cat.name}
                  title={cat.name}
                  emojis={cat.emojis}
                  onPick={pick}
                  selected={value}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface SectionProps {
  title: string;
  emojis: EmojiEntry[];
  onPick: (char: string) => void;
  selected: string;
  emptyHint?: string;
}

const Section = memo(function Section({ title, emojis, onPick, selected, emptyHint }: SectionProps) {
  if (emojis.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground">
        {emptyHint ?? "Nothing here."}
      </div>
    );
  }
  return (
    <div>
      <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="grid grid-cols-8 gap-1">
        {emojis.map((e) => (
          <button
            key={e.char}
            type="button"
            onClick={() => onPick(e.char)}
            aria-label={`${e.char} ${e.keywords}`}
            title={e.keywords}
            className={cn(
              "h-8 w-8 flex items-center justify-center rounded-md text-lg transition-colors",
              "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
              selected === e.char && "bg-primary/15 ring-1 ring-primary/40"
            )}
          >
            {e.char}
          </button>
        ))}
      </div>
    </div>
  );
});
