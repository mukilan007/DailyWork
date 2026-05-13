// Small client-side export helpers. Generates CSV/JSON blobs from in-memory
// rows and triggers a browser download — no server round-trip.

export type ExportFormat = "csv" | "json";

/** Escape a single cell for RFC-4180 CSV. */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (v instanceof Date) {
    s = v.toISOString();
  } else if (Array.isArray(v)) {
    s = v.join("; ");
  } else if (typeof v === "object") {
    s = JSON.stringify(v);
  } else {
    s = String(v);
  }
  // Quote if it contains comma, quote, newline, or carriage return.
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Serialize an array of records to a CSV string. The first row of `rows` is
 * inspected for keys; pass explicit `columns` to control ordering or to
 * include keys missing from the first row.
 */
export function toCSV<T extends Record<string, unknown>>(
  rows: T[],
  columns?: (keyof T)[]
): string {
  if (rows.length === 0 && !columns) return "";
  const cols = (columns ?? (Object.keys(rows[0] ?? {}) as (keyof T)[])).map(String);
  const header = cols.map(csvCell).join(",");
  const body = rows
    .map((r) => cols.map((c) => csvCell((r as Record<string, unknown>)[c])).join(","))
    .join("\n");
  return rows.length === 0 ? header : `${header}\n${body}`;
}

/** Pretty-print JSON for export. */
export function toJSON(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/** Trigger a browser download for the given text content. */
export function downloadFile(
  filename: string,
  content: string,
  mime = "text/plain;charset=utf-8"
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so Safari/Firefox finalise the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** YYYY-MM-DD for the local date — handy for filenames. */
export function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface ExportReportArgs<T extends Record<string, unknown>> {
  /** Base filename without extension, e.g. "todos". */
  name: string;
  format: ExportFormat;
  rows: T[];
  /** Optional column order for CSV. */
  columns?: (keyof T)[];
  /** Optional metadata embedded in JSON exports. */
  meta?: Record<string, unknown>;
}

/**
 * Convenience: serialize `rows` in the requested format and trigger a download.
 * For JSON exports, an `exported_at` timestamp and any `meta` are wrapped
 * around the rows so the report is self-describing.
 */
export function exportReport<T extends Record<string, unknown>>({
  name,
  format,
  rows,
  columns,
  meta,
}: ExportReportArgs<T>): void {
  const stamp = todayStamp();
  if (format === "csv") {
    const csv = toCSV(rows, columns);
    downloadFile(`${name}-${stamp}.csv`, csv, "text/csv;charset=utf-8");
    return;
  }
  const payload = {
    exported_at: new Date().toISOString(),
    ...(meta ?? {}),
    count: rows.length,
    rows,
  };
  downloadFile(`${name}-${stamp}.json`, toJSON(payload), "application/json");
}
