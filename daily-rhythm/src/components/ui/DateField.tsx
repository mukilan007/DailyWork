import { ChangeEvent, useMemo, useRef } from "react";
import { Calendar } from "lucide-react";
import { ymd, addDays } from "@/lib/dates";
import { cn } from "@/lib/utils";

interface DateFieldProps {
  id?: string;
  /** Value in YYYY-MM-DD (local). */
  value: string;
  onChange: (next: string) => void;
  /** Inclusive bounds, YYYY-MM-DD. */
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** Show Today / Yesterday quick-pick chips below the field. Default true. */
  quickPicks?: boolean;
}

/**
 * Stylised date picker. Wraps the native `<input type="date">` so we get
 * free a11y + keyboard support, but hides the browser's default calendar
 * glyph (which renders inconsistently across Chrome/Safari/Firefox) and
 * replaces it with a lucide icon. The entire field is clickable — we call
 * `showPicker()` on click for browsers that support it.
 */
export function DateField({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
  required,
  className,
  quickPicks = true,
}: DateFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const today = ymd();
  const yesterday = ymd(addDays(new Date(), -1));

  const preview = useMemo(() => {
    if (!value) return "";
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return "";
    if (value === today) return "Today";
    if (value === yesterday) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  }, [value, today, yesterday]);

  function openPicker() {
    const el = inputRef.current;
    if (!el || disabled) return;
    // showPicker is widely supported in modern browsers; fall back to focus.
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker();
        return;
      } catch {
        /* some browsers throw if not user-initiated; fall through */
      }
    }
    el.focus();
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value);
  }

  function setTo(next: string) {
    if (disabled) return;
    onChange(next);
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div
        role="group"
        onClick={openPicker}
        className={cn(
          "group relative flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-sm",
          "transition-colors hover:border-ring/60",
          "focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:border-ring",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <Calendar className="h-4 w-4 shrink-0 text-muted-foreground group-focus-within:text-primary" />
        <input
          ref={inputRef}
          id={id}
          type="date"
          value={value}
          onChange={handleChange}
          min={min}
          max={max}
          disabled={disabled}
          required={required}
          aria-label="Date"
          className={cn(
            "flex-1 bg-transparent outline-none tabular-nums",
            // Hide the browser's default calendar-picker glyph (we render our own).
            "[&::-webkit-calendar-picker-indicator]:absolute",
            "[&::-webkit-calendar-picker-indicator]:inset-0",
            "[&::-webkit-calendar-picker-indicator]:h-full",
            "[&::-webkit-calendar-picker-indicator]:w-full",
            "[&::-webkit-calendar-picker-indicator]:cursor-pointer",
            "[&::-webkit-calendar-picker-indicator]:opacity-0",
            "disabled:cursor-not-allowed"
          )}
        />
        {preview && (
          <span className="pointer-events-none ml-auto text-xs text-muted-foreground tabular-nums">
            {preview}
          </span>
        )}
      </div>

      {quickPicks && !disabled && (
        <div className="flex items-center gap-1.5">
          <QuickChip active={value === today} onClick={() => setTo(today)}>
            Today
          </QuickChip>
          <QuickChip active={value === yesterday} onClick={() => setTo(yesterday)}>
            Yesterday
          </QuickChip>
        </div>
      )}
    </div>
  );
}

function QuickChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "text-[11px] px-2.5 py-1 rounded-full border transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-input text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
