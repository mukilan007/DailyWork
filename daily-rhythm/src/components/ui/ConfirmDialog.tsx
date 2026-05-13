import { ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";

export type ConfirmAction = {
  /** Stable id for React reconciliation; falls back to `label` when omitted.
   *  Prefer providing one when the label changes between renders (e.g. while
   *  busy) so the button isn't remounted and focus isn't lost. */
  id?: string;
  label: string;
  onClick: () => void | Promise<void>;
  variant?: "default" | "destructive" | "outline" | "ghost" | "secondary";
};

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Short string description shown beneath the title. */
  description?: string;
  /** Optional custom body — rendered between description and actions. */
  children?: ReactNode;
  /** Custom action buttons. When provided, `onConfirm`/`confirmLabel` are ignored. */
  actions?: ConfirmAction[];
  /** Convenience destructive/primary confirm. Used when `actions` is omitted. */
  onConfirm?: () => void | Promise<void>;
  confirmLabel?: string;
  destructive?: boolean;
  cancelLabel?: string;
  /** When true, every button (including Cancel) is disabled and `onClose`
   *  is suppressed — used while an action is in-flight. */
  busy?: boolean;
  onClose: () => void;
}

/**
 * In-app replacement for window.confirm — a custom modal that supports an
 * arbitrary set of action buttons (e.g. "Delete this day" vs "Delete entire
 * period") so flows aren't limited to a binary yes/no choice.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  actions,
  onConfirm,
  confirmLabel = "Confirm",
  destructive = false,
  cancelLabel = "Cancel",
  busy = false,
  onClose,
}: ConfirmDialogProps) {
  const resolved: ConfirmAction[] =
    actions ??
    (onConfirm
      ? [
          {
            id: "confirm",
            label: confirmLabel,
            onClick: onConfirm,
            variant: destructive ? "destructive" : "default",
          },
        ]
      : []);

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (busy) return;
        onClose();
      }}
      title={title}
      description={description}
      className="max-w-md"
    >
      <div className="space-y-4">
        {children}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          {resolved.map((a) => (
            <Button
              key={a.id ?? a.label}
              type="button"
              variant={a.variant ?? "default"}
              disabled={busy}
              onClick={async () => {
                await a.onClick();
              }}
            >
              {a.label}
            </Button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
