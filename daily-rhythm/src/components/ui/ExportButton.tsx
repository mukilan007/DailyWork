import { ReactNode, useEffect, useRef, useState } from "react";
import { Download, FileText, Braces } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { ExportFormat } from "@/lib/export";

interface ExportButtonProps {
  /** Called when the user picks a format. Should trigger the actual download. */
  onExport: (format: ExportFormat) => void | Promise<void>;
  /** Disable when there's nothing to export or data is still loading. */
  disabled?: boolean;
  /** Show on the right side of the page header by default. */
  label?: string;
  /** Visual variant; defaults to secondary so it reads on both light and dark themes. */
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm";
  className?: string;
}

/**
 * Dropdown that lets the user export the current page's data as CSV or JSON.
 * The actual data-shaping happens in the parent via `onExport`.
 */
export function ExportButton({
  onExport,
  disabled,
  label = "Export",
  variant = "secondary",
  size = "default",
  className,
}: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  async function pick(format: ExportFormat) {
    setOpen(false);
    setBusy(true);
    try {
      await onExport(format);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Download className="h-4 w-4" />
        {busy ? "Exporting…" : label}
      </Button>

      {open && (
        <div
          role="menu"
          aria-label="Export format"
          className={cn(
            "absolute right-0 z-50 mt-1 w-44 rounded-md border border-border bg-card text-card-foreground shadow-lg",
            "py-1"
          )}
        >
          <MenuItem
            icon={<FileText className="h-4 w-4" />}
            label="Download CSV"
            hint=".csv"
            onClick={() => pick("csv")}
          />
          <MenuItem
            icon={<Braces className="h-4 w-4" />}
            label="Download JSON"
            hint=".json"
            onClick={() => pick("json")}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-sm",
        "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none"
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {hint && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{hint}</span>}
    </button>
  );
}
