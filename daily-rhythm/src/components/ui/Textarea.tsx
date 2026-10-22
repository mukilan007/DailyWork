import { TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        // `resize-y` keeps the drag grip (vertical only — horizontal dragging
        // broke the dialog's grid), bounded by `max-h` so a drag can never
        // grow the field past the dialog; past that the field scrolls itself.
        "flex min-h-[80px] max-h-[40vh] w-full resize-y overflow-auto",
        "rounded-md border border-input bg-background px-3 py-2 text-sm",
        "placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
