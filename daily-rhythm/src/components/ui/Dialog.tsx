import { ReactNode, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /** When true, clicking the backdrop does NOT close the dialog — only the
   *  X button, Escape, or an explicit action inside the dialog can (all of
   *  which still go through `onClose`, so callers can guard those too).
   *  Purely additive: defaults to false, so existing dialogs are unchanged.
   *  Use for flows where a stray outside click would destroy in-progress
   *  work (e.g. a half-reviewed statement import). */
  disableOutsideClose?: boolean;
  /** When true, the panel can be drag-resized via a native grip at its
   *  bottom-right corner (starts at ~56rem, up to 95vw / 90vh). Purely
   *  additive — callers enable it only when content benefits (e.g. wide table
   *  rows, or a long free-text body the user may want more room for). */
  resizable?: boolean;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
  disableOutsideClose = false,
  resizable = false,
}: DialogProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={disableOutsideClose ? undefined : onClose}
    >
      <div
        className={cn(
          // `flex-col` + a hard `max-h` keep the panel inside the viewport no
          // matter how tall the content (or a drag-resized textarea) gets; the
          // body below is the only part that scrolls, so the title and the
          // action buttons inside it stay reachable.
          "relative flex flex-col overflow-hidden",
          "rounded-xl border bg-card text-card-foreground shadow-lg",
          // `cn` is a plain concatenation (not tailwind-merge), so conflicting
          // utilities would be resolved by stylesheet order rather than by the
          // order written here. Emit exactly one sizing set to avoid that.
          // `resize` also needs the non-visible overflow set above to render
          // its grip.
          resizable
            ? "w-[56rem] min-w-[min(22rem,100%)] max-w-[95vw] min-h-[min(20rem,100%)] max-h-[90vh] resize"
            : "w-full max-w-lg max-h-[85vh]",
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 p-6 pb-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold leading-none tracking-tight">{title}</h2>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* `min-h-0` lets this flex child shrink below its content height,
            which is what actually enables the overflow to scroll. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}
