import { useEffect } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export type ToastKind = "error" | "success" | "info";

const STYLES: Record<ToastKind, { ring: string; bg: string; text: string; icon: typeof AlertCircle }> = {
  error: {
    ring: "ring-destructive/30",
    bg: "bg-destructive/10",
    text: "text-destructive",
    icon: AlertCircle,
  },
  success: {
    ring: "ring-emerald-500/30",
    bg: "bg-emerald-500/10",
    text: "text-emerald-700 dark:text-emerald-300",
    icon: CheckCircle2,
  },
  info: {
    ring: "ring-primary/30",
    bg: "bg-primary/10",
    text: "text-primary",
    icon: Info,
  },
};

export function Toast({
  kind,
  title,
  message,
  onDismiss,
  duration = 6000,
}: {
  kind: ToastKind;
  title?: string;
  message: string;
  onDismiss: () => void;
  duration?: number;
}) {
  useEffect(() => {
    if (duration <= 0) return;
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
  }, [duration, onDismiss]);

  const s = STYLES[kind];
  const Icon = s.icon;
  const role = kind === "error" ? "alert" : "status";

  return (
    <div className="fixed inset-x-0 top-4 z-50 flex justify-center px-4 pointer-events-none">
      <div
        role={role}
        className={`pointer-events-auto flex items-start gap-3 rounded-lg border bg-card shadow-lg ring-1 ${s.ring} ${s.bg} ${s.text} px-4 py-3 max-w-md w-full`}
      >
        <Icon className="h-5 w-5 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          {title && <p className="text-sm font-medium leading-tight">{title}</p>}
          <p className={`text-sm ${title ? "mt-0.5 opacity-90" : ""} break-words`}>{message}</p>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="rounded-md p-1 hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
