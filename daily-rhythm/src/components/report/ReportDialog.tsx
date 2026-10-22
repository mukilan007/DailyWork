import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";
import {
  allFieldsFor,
  FIELD_LABEL,
  formatDay,
  REPORT_FORMAT_LABEL,
  type ReportData,
  type ReportFields,
  type ReportFormat,
} from "@/lib/report-core";

/** Shared download dialog — the Work Done log and the Todos board both export
 *  the same five formats from the same engine, so they share this picker. */
const FORMATS: ReportFormat[] = ["visual", "html", "md", "csv", "pdf"];

const FORMAT_HINT: Record<ReportFormat, string> = {
  visual:
    "Charts and highlights — activity, categories, breakdown. Best for sharing.",
  html: "Styled document. Opens in any browser; print to PDF with Cmd/Ctrl+P.",
  md: "Plain text for Slack, Notion, GitHub or email.",
  csv: "Spreadsheet rows — one line per task.",
  pdf: "A ready-to-attach PDF file.",
};

export function ReportDialog({
  open,
  onClose,
  from,
  to,
  entryCount,
  report,
  noun = "task",
  onDownload,
}: {
  open: boolean;
  onClose: () => void;
  /** The period being exported — owned by the page's own date filter. */
  from: string;
  to: string;
  entryCount: number;
  /** Supplies the field list: core labels plus whatever extras this source
   *  offers (a todo board's priority, due date, tags and custom fields). */
  report: ReportData;
  /** What the rows are called in the summary line. */
  noun?: string;
  onDownload: (format: ReportFormat, fields: ReportFields) => Promise<void>;
}) {
  const [format, setFormat] = useState<ReportFormat>("visual");
  const [generating, setGenerating] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // Two steps: pick the format, then pick what goes in it.
  const [step, setStep] = useState<"format" | "fields">("format");
  const [fields, setFields] = useState<ReportFields>(() => allFieldsFor(report));

  // The field list is per-source, so re-seed when the source changes (a
  // different space has different custom fields).
  useEffect(() => {
    setFields(allFieldsFor(report));
  }, [report.extraDefs, report.labels]);

  // Reset to step one whenever the dialog reopens, so a half-finished pick
  // from last time never carries over.
  useEffect(() => {
    if (open) return;
    setStep("format");
    setFailed(null);
  }, [open]);

  type CoreKey = Exclude<keyof ReportFields, "extras">;
  const coreKeys = Object.keys(FIELD_LABEL) as CoreKey[];
  const allKeys = [
    ...coreKeys.map((k) => ({ key: k, label: report.labels[k] ?? FIELD_LABEL[k], extra: false })),
    ...report.extraDefs.map((d) => ({ key: d.key, label: d.label, extra: true })),
  ];
  const isOn = (f: { key: string; extra: boolean }) =>
    f.extra ? !!fields.extras[f.key] : fields[f.key as CoreKey];
  const onCount = allKeys.filter(isOn).length;
  const allOn = onCount === allKeys.length;
  const anyField = onCount > 0;
  const setAll = (on: boolean) =>
    setFields({
      ...(Object.fromEntries(coreKeys.map((k) => [k, on])) as Record<CoreKey, boolean>),
      extras: Object.fromEntries(report.extraDefs.map((d) => [d.key, on])),
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={step === "format" ? "Download report" : "What goes in the report?"}
      description={
        step === "format"
          ? `${formatDay(from)} — ${formatDay(to)} · ${entryCount} ${noun}${
              entryCount === 1 ? "" : "s"
            }`
          : `${REPORT_FORMAT_LABEL[format]} · only ticked fields are included.`
      }
    >
      <div className="space-y-4">
        {step === "format" ? (
        <div className="space-y-2">
          {FORMATS.map((f) => (
            <label
              key={f}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                format === f
                  ? "border-primary bg-primary/5"
                  : "border-input hover:bg-accent"
              )}
            >
              <input
                type="radio"
                name="report-format"
                value={f}
                checked={format === f}
                onChange={() => setFormat(f)}
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {REPORT_FORMAT_LABEL[f]}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {FORMAT_HINT[f]}
                </span>
              </span>
            </label>
          ))}
        </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {allOn ? "Everything is included." : `${onCount} of ${allKeys.length} fields`}
              </p>
              <button
                type="button"
                onClick={() => setAll(!allOn)}
                className="text-xs text-primary hover:underline"
              >
                {allOn ? "Clear all" : "Select all"}
              </button>
            </div>
            {allKeys.map((f) => (
              <label
                key={`${f.extra ? "x" : "c"}-${f.key}`}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors",
                  isOn(f) ? "border-primary bg-primary/5" : "border-input hover:bg-accent"
                )}
              >
                <input
                  type="checkbox"
                  checked={isOn(f)}
                  onChange={(e) =>
                    setFields((cur) =>
                      f.extra
                        ? { ...cur, extras: { ...cur.extras, [f.key]: e.target.checked } }
                        : { ...cur, [f.key]: e.target.checked }
                    )
                  }
                />
                <span className="text-sm font-medium">{f.label}</span>
              </label>
            ))}
            {!anyField && (
              <p className="text-xs text-amber-500">
                Nothing ticked — the report would have no content. Pick at least
                one field.
              </p>
            )}
          </div>
        )}

        {entryCount === 0 && (
          <p className="text-xs text-amber-500">
            Nothing in this period — the report will be empty. Widen the date
            range on the page first.
          </p>
        )}

        {failed && (
          <p className="text-xs text-rose-500" role="alert">
            Couldn&apos;t generate the report: {failed}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => (step === "fields" ? setStep("format") : onClose())}
            disabled={generating}
          >
            {step === "fields" ? "Back" : "Cancel"}
          </Button>
          {step === "format" ? (
            <Button type="button" onClick={() => setStep("fields")}>
              Next
            </Button>
          ) : (
          <Button
            type="button"
            disabled={generating || !anyField}
            onClick={async () => {
              setGenerating(true);
              setFailed(null);
              try {
                await onDownload(format, fields);
                onClose();
              } catch (err) {
                // Keep the dialog open so the error is visible and the user
                // can retry or pick a different format.
                setFailed(err instanceof Error ? err.message : String(err));
              } finally {
                setGenerating(false);
              }
            }}
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Generating…
              </>
            ) : (
              <>
                <Download className="h-4 w-4" /> Download
              </>
            )}
          </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
