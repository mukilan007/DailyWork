// Generic report engine, shared by the Work Done log and the Todos board.
//
// Callers normalise their own rows into `ReportItem[]` (see work-log-report.ts
// and todo-report.ts) and everything below — grouping, roll-ups and all five
// renderers — is written against that shape only.
//
// Four output formats, all generated client-side:
//   html — self-contained, styled, prints to PDF from any browser
//   md   — pastes cleanly into Slack / Notion / GitHub / email
//   csv  — spreadsheet rows
//   pdf  — a real .pdf via jsPDF (laid out by hand; see renderPdf)

// `jspdf` is imported *dynamically* in `renderPdf` — it drags in html2canvas
// and core-js, which added ~137 kB gzip to the main bundle when imported
// statically. Only the PDF format pays for it, and only when chosen.
import type { jsPDF } from "jspdf";
import { downloadFile } from "@/lib/export";
import { toCSV } from "@/lib/export";

import type { EntryType } from "@/types";

/** One row in a report, whatever it was built from. */
export interface ReportItem {
  id: string;
  /** Tasks render as prose; issues and bugs render as tables. */
  entryType: EntryType;
  /** The day this belongs to (YYYY-MM-DD). */
  day: string;
  title: string;
  details: string | null;
  /** Broad grouping — product area for work log, space for todos. */
  module: string | null;
  /** Finer grouping — kind of work, or the board's own category. */
  category: string | null;
  /** Stable key for the state, used to colour consistently. */
  statusKey: string;
  statusLabel: string;
  /** Neutral wording for the visual report; falls back to `statusLabel`. */
  statusLabelPositive?: string;
  /** Counts toward "completed" in the headline figures. */
  statusDone: boolean;
  minutes: number | null;
  /** Tie-break within a day. */
  position: number;
  /** Secondary tie-break. */
  created_at: string;
}

/** Section headings — plural, because they title a group. */
export const ENTRY_TYPE_LABEL: Record<EntryType, string> = {
  task: "Tasks",
  customer_issue: "Customer Issues",
  bugtracker: "Bugtracker",
};

/** Row-level label, for a single record (CSV's `type` column). */
export const ENTRY_TYPE_LABEL_ONE: Record<EntryType, string> = {
  task: "Task",
  customer_issue: "Customer Issue",
  bugtracker: "Bugtracker",
};

/** The two kinds that read better as a grid than as paragraphs. */
export const TABLE_TYPES: EntryType[] = ["customer_issue", "bugtracker"];

/** Which per-item fields the reader asked for. Everything is optional,
 *  including the task name and the date — a section whose whole dimension is
 *  excluded is omitted rather than rendered empty, and with the date off the
 *  report becomes one flat list instead of day-by-day. */
export interface ReportFields {
  title: boolean;
  date: boolean;
  details: boolean;
  module: boolean;
  category: boolean;
  status: boolean;
  minutes: boolean;
}

export const ALL_FIELDS: ReportFields = {
  title: true,
  date: true,
  details: true,
  module: true,
  category: true,
  status: true,
  minutes: true,
};

export const FIELD_LABEL: Record<keyof ReportFields, string> = {
  title: "Task/ID",
  date: "Date",
  details: "Details",
  module: "Module",
  category: "Category",
  status: "Status",
  minutes: "Time spent",
};

export type ReportFormat = "visual" | "html" | "md" | "csv" | "pdf";

export const REPORT_FORMAT_LABEL: Record<ReportFormat, string> = {
  visual: "Visual report (charts)",
  html: "Printable HTML (→ PDF)",
  md: "Markdown",
  csv: "CSV",
  pdf: "PDF",
};

export interface ReportMeta {
  /** Who the report is for / from — printed in the header when present. */
  author?: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

export interface DayGroup {
  day: string;
  entries: ReportItem[];
  minutes: number;
}

export interface ReportData {
  meta: ReportMeta;
  days: DayGroup[];
  totals: {
    entries: number;
    minutes: number;
    daysWorked: number;
    /** Distinct states, most-used first; `done` ones lead. */
    byStatus: Array<{ key: string; label: string; positiveLabel: string; count: number; done: boolean }>;
    /** Items whose state counts as finished. */
    doneCount: number;
    byCategory: Array<{ category: string; entries: number; minutes: number }>;
    byModule: Array<{ module: string; entries: number; minutes: number }>;
  };
}

/** "1h 30m" / "45m" / "—" */
export function formatMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined || min <= 0) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** "Mon, 22 Oct 2026" — stable across locales so the report reads the same
 *  for whoever opens it. Parsed as a local date to avoid a UTC day shift. */
export function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Group entries into descending days with per-day totals and roll-ups. */
export function buildReport(entries: ReportItem[], meta: ReportMeta): ReportData {
  const inRange = entries
    .filter((e) => e.day >= meta.from && e.day <= meta.to)
    .sort(
      (a, b) =>
        b.day.localeCompare(a.day) ||
        a.position - b.position ||
        a.created_at.localeCompare(b.created_at)
    );

  const byDay = new Map<string, ReportItem[]>();
  for (const e of inRange) {
    const list = byDay.get(e.day);
    if (list) list.push(e);
    else byDay.set(e.day, [e]);
  }

  const days: DayGroup[] = [...byDay.entries()].map(([day, list]) => ({
    day,
    entries: list,
    minutes: list.reduce((s, e) => s + (e.minutes ?? 0), 0),
  }));

  const statusMap = new Map<
    string,
    { key: string; label: string; positiveLabel: string; count: number; done: boolean }
  >();
  const catMap = new Map<string, { entries: number; minutes: number }>();
  const modMap = new Map<string, { entries: number; minutes: number }>();
  const tally = (
    m: Map<string, { entries: number; minutes: number }>,
    key: string,
    mins: number
  ) => {
    const cur = m.get(key) ?? { entries: 0, minutes: 0 };
    cur.entries += 1;
    cur.minutes += mins;
    m.set(key, cur);
  };
  for (const e of inRange) {
    const st = statusMap.get(e.statusKey) ?? {
      key: e.statusKey,
      label: e.statusLabel,
      positiveLabel: e.statusLabelPositive ?? e.statusLabel,
      count: 0,
      done: e.statusDone,
    };
    st.count += 1;
    statusMap.set(e.statusKey, st);
    tally(catMap, e.category?.trim() || "Uncategorised", e.minutes ?? 0);
    // Rows predating the module field have none; they're grouped rather than
    // dropped so the module totals still add up to the period total.
    tally(modMap, e.module?.trim() || "Unassigned", e.minutes ?? 0);
  }
  const rank = <T extends { entries: number; minutes: number }>(a: T, b: T) =>
    b.minutes - a.minutes || b.entries - a.entries;

  return {
    meta,
    days,
    totals: {
      entries: inRange.length,
      minutes: inRange.reduce((s, e) => s + (e.minutes ?? 0), 0),
      daysWorked: days.length,
      // Finished states first, then by volume — so the composition bar reads
      // left-to-right from "done" and the palette slots stay stable.
      byStatus: [...statusMap.values()].sort(
        (a, b) => Number(b.done) - Number(a.done) || b.count - a.count
      ),
      doneCount: inRange.filter((e) => e.statusDone).length,
      byCategory: [...catMap.entries()]
        .map(([category, v]) => ({ category, ...v }))
        .sort(rank),
      byModule: [...modMap.entries()]
        .map(([module, v]) => ({ module, ...v }))
        .sort(rank),
    },
  };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/** Day groups of the prose entries, or one ungrouped list when the date is
 *  excluded. Issues and bugs are handled separately as tables. */
function groupsFor(
  r: ReportData,
  fields: ReportFields
): Array<{ day: string | null; entries: ReportItem[]; minutes: number }> {
  const keep = (list: ReportItem[]) => list.filter((e) => e.entryType === "task");
  if (fields.date) {
    return r.days
      .map((d) => ({ ...d, entries: keep(d.entries) }))
      .filter((d) => d.entries.length > 0)
      .map((d) => ({ ...d, minutes: d.entries.reduce((s, e) => s + (e.minutes ?? 0), 0) }));
  }
  const all = keep(r.days.flatMap((d) => d.entries));
  if (all.length === 0) return [];
  return [{ day: null, entries: all, minutes: all.reduce((s, e) => s + (e.minutes ?? 0), 0) }];
}

/** Flat, date-ordered rows of one tabular type. */
function itemsOfType(r: ReportData, type: EntryType): ReportItem[] {
  return r.days.flatMap((d) => d.entries.filter((e) => e.entryType === type));
}

/** Column set for a table, narrowed to the chosen fields. */
function tableColumns(fields: ReportFields): Array<{ key: keyof ReportFields; label: string }> {
  return (
    [
      { key: "date", label: "Date" },
      { key: "title", label: FIELD_LABEL.title },
      { key: "module", label: FIELD_LABEL.module },
      { key: "category", label: FIELD_LABEL.category },
      { key: "status", label: FIELD_LABEL.status },
      { key: "minutes", label: FIELD_LABEL.minutes },
      { key: "details", label: FIELD_LABEL.details },
    ] as Array<{ key: keyof ReportFields; label: string }>
  ).filter((c) => fields[c.key]);
}

/** One cell's text for a tabular row. */
function cellText(e: ReportItem, key: keyof ReportFields): string {
  switch (key) {
    case "date":
      return formatDay(e.day);
    case "title":
      return e.title;
    case "module":
      return e.module ?? "";
    case "category":
      return e.category ?? "";
    case "status":
      return e.statusLabel;
    case "minutes":
      return formatMinutes(e.minutes);
    case "details":
      return e.details ?? "";
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A tabular section for one entry type, or "" when it has no rows. */
function tableSectionHtml(
  r: ReportData,
  type: EntryType,
  fields: ReportFields,
  cls: string
): string {
  const rows = itemsOfType(r, type);
  const cols = tableColumns(fields);
  if (rows.length === 0 || cols.length === 0) return "";
  const head = cols.map((c) => `<th>${esc(c.label)}</th>`).join("");
  const body = rows
    .map(
      (e) =>
        `<tr>${cols
          .map(
            (c) =>
              `<td class="${c.key === "details" ? "wrap" : ""}">${esc(cellText(e, c.key))}</td>`
          )
          .join("")}</tr>`
    )
    .join("");
  return `<h2>${esc(ENTRY_TYPE_LABEL[type])}</h2>
  <div class="${cls}"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function renderHtml(r: ReportData, fields: ReportFields = ALL_FIELDS): string {
  const { meta, totals } = r;
  const colors = statusColors(r);
  const period = `${formatDay(meta.from)} — ${formatDay(meta.to)}`;

  const summaryRows = totals.byCategory
    .map(
      (c) =>
        `<tr><td>${esc(c.category)}</td><td class="num">${c.entries}</td><td class="num">${esc(
          formatMinutes(c.minutes)
        )}</td></tr>`
    )
    .join("");

  const daySections = groupsFor(r, fields)
    .map(
      (d) => `
    <section class="day">
      ${d.day === null ? "" : `<h3>${esc(formatDay(d.day))} ${
        fields.minutes
          ? `<span class="day-total">${esc(formatMinutes(d.minutes))}</span>`
          : ""
      }</h3>`}
      ${d.entries
        .map(
          (e) => `
        <article class="entry">
          <div class="entry-head">
            ${fields.title ? `<span class="title">${esc(e.title)}</span>` : ""}
            ${
              fields.status
                ? `<span class="badge" style="background:${colors.get(
                    e.statusKey
                  )};border-color:${colors.get(e.statusKey)};color:#fff">${esc(
                    e.statusLabel
                  )}</span>`
                : ""
            }
            ${fields.module && e.module ? `<span class="badge mod">${esc(e.module)}</span>` : ""}
            ${fields.category && e.category ? `<span class="badge cat">${esc(e.category)}</span>` : ""}
            ${fields.minutes ? `<span class="mins">${esc(formatMinutes(e.minutes))}</span>` : ""}
          </div>
          ${fields.details && e.details ? `<p class="details">${esc(e.details)}</p>` : ""}
        </article>`
        )
        .join("")}
    </section>`
    )
    .join("");

  // Self-contained: inline styles only, no network fetches, so the file works
  // offline and as an email attachment.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Work report — ${esc(period)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px; font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #18181b; background: #fff; }
  .wrap { max-width: 820px; margin: 0 auto; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .period { color: #52525b; margin: 0 0 24px; }
  .author { color: #52525b; margin: 0 0 24px; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
  .card { border: 1px solid #e4e4e7; border-radius: 8px; padding: 12px; }
  .card .k { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #71717a; }
  .card .v { font-size: 20px; font-weight: 600; margin-top: 2px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .05em; color: #71717a; margin: 28px 0 10px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #e4e4e7; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #71717a; }
  td.num, th.num { text-align: right; }
  .day { margin-bottom: 22px; page-break-inside: avoid; }
  .day h3 { font-size: 14px; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 2px solid #18181b; display: flex; justify-content: space-between; }
  .day-total { font-weight: 400; color: #52525b; }
  .entry { padding: 8px 0 8px 12px; border-left: 3px solid #e4e4e7; margin-bottom: 8px; page-break-inside: avoid; }
  .entry-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .title { font-weight: 600; }
  .mins { margin-left: auto; color: #52525b; font-variant-numeric: tabular-nums; }
  .badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid #d4d4d8; color: #3f3f46; }
  .s-done { background: #dcfce7; border-color: #86efac; color: #166534; }
  .s-in_progress { background: #fef9c3; border-color: #fde047; color: #854d0e; }
  .s-blocked { background: #fee2e2; border-color: #fca5a5; color: #991b1b; }
  .cat { background: #f4f4f5; }
  .mod { background: #e7effc; border-color: #b7d3f6; color: #184f95; }
  .details { margin: 6px 0 0; color: #3f3f46; white-space: pre-wrap; }
  .empty { color: #71717a; font-style: italic; }
  .tablewrap { overflow-x: auto; }
  table.grid { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.grid th { background: #f4f4f5; font-size: 11px; text-transform: uppercase;
                  letter-spacing: .04em; color: #52525b; white-space: nowrap; }
  table.grid th, table.grid td { border: 1px solid #e4e4e7; padding: 6px 8px;
                                 text-align: left; vertical-align: top; }
  table.grid td.wrap { white-space: pre-wrap; min-width: 16rem; }
  table.grid tr { page-break-inside: avoid; }
  footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e4e4e7; color: #a1a1aa; font-size: 12px; }
  @media print { body { padding: 0; } .card { break-inside: avoid; } }
</style></head>
<body><div class="wrap">
  <h1>Work report</h1>
  <p class="period">${esc(period)}</p>
  ${meta.author ? `<p class="author">${esc(meta.author)}</p>` : ""}

  <div class="cards">
    <div class="card"><div class="k">Tasks</div><div class="v">${totals.entries}</div></div>
    <div class="card"><div class="k">Days worked</div><div class="v">${totals.daysWorked}</div></div>
    ${
      fields.minutes
        ? `<div class="card"><div class="k">Time logged</div><div class="v">${esc(
            formatMinutes(totals.minutes)
          )}</div></div>`
        : ""
    }
    ${
      fields.status
        ? `<div class="card"><div class="k">Completed</div><div class="v">${totals.doneCount}</div></div>`
        : ""
    }
  </div>

  ${
    fields.category && totals.byCategory.length > 0
      ? `<h2>By category</h2>
  <table><thead><tr><th>Category</th><th class="num">Tasks</th><th class="num">Time</th></tr></thead>
  <tbody>${summaryRows}</tbody></table>`
      : ""
  }

  ${
    daySections
      ? `<h2>${fields.date ? "Daily breakdown" : "All items"}</h2>
  ${daySections}`
      : ""
  }

  ${TABLE_TYPES.map((t) => tableSectionHtml(r, t, fields, "tablewrap")).join("\n  ")}

  ${
    daySections || TABLE_TYPES.some((t) => itemsOfType(r, t).length > 0)
      ? ""
      : '<p class="empty">No work logged in this period.</p>'
  }

  <footer>Generated ${new Date().toLocaleString("en-GB")} · DailyWork</footer>
</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Visual report
//
// Colours come from the validated categorical palette (slots 1-3, assigned in
// fixed order). Validator on those three, light surface, all pairs: worst CVD
// ΔE 9.2, worst normal-vision ΔE 24.0 — both clear. The aqua slot sits at
// 2.74:1 against the surface, below the 3:1 bar, so the relief rule applies:
// every segment carries a visible direct label and never relies on hue alone.
//
// Deliberately light-only. This is a document made to be printed and attached,
// and a dark surface is wrong on paper.
// ---------------------------------------------------------------------------

/** Categorical slots in fixed order — assigned to states by `byStatus` order,
 *  never cycled. Past eight, a state folds into the last slot rather than
 *  inventing a hue. */
const SERIES = [
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100",
  "#e87ba4", "#008300", "#4a3aa7", "#e34948",
];

/** Stable key → colour, from the report's own status ordering. */
export function statusColors(r: ReportData): Map<string, string> {
  return new Map(
    r.totals.byStatus.map((st, i) => [st.key, SERIES[Math.min(i, SERIES.length - 1)]])
  );
}

const VIZ = {
  surface: "#fcfcfb",
  ink: "#0b0b0b",
  muted: "#52514e",
  faint: "#e4e4e1",
  s1: "#2a78d6",
  s2: "#eb6834",
  s3: "#1baf7a",
};

/** Bar with its data-end rounded and its baseline end square (4px radius). */
function barUp(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, h, w / 2);
  if (h <= 0) return "";
  return `M${x} ${y + h}V${y + rr}a${rr} ${rr} 0 0 1 ${rr} -${rr}h${w - rr * 2}a${rr} ${rr} 0 0 1 ${rr} ${rr}V${y + h}Z`;
}
function barRight(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, w, h / 2);
  if (w <= 0) return "";
  return `M${x} ${y}h${w - rr}a${rr} ${rr} 0 0 1 ${rr} ${rr}v${h - rr * 2}a${rr} ${rr} 0 0 1 -${rr} ${rr}H${x}Z`;
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const cur = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  while (cur <= end && out.length < 400) {
    out.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(
        cur.getDate()
      ).padStart(2, "0")}`
    );
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Activity over the period. One bar per day, or per week once the window is
 *  long enough that daily bars would be unreadable. */
function chartActivity(r: ReportData, byTime: boolean): string {
  const minutesByDay = new Map(
    r.days.map((d) => [d.day, byTime ? d.minutes : d.entries.length])
  );
  const days = eachDay(r.meta.from, r.meta.to);
  if (days.length === 0) return "";

  const weekly = days.length > 31;
  type Bucket = { label: string; full: string; value: number };
  const buckets: Bucket[] = [];
  if (weekly) {
    for (let i = 0; i < days.length; i += 7) {
      const chunk = days.slice(i, i + 7);
      buckets.push({
        label: formatDay(chunk[0]).slice(5, 11),
        full: `${formatDay(chunk[0])} – ${formatDay(chunk[chunk.length - 1])}`,
        value: chunk.reduce((s, d) => s + (minutesByDay.get(d) ?? 0), 0),
      });
    }
  } else {
    for (const d of days) {
      buckets.push({
        label: d.slice(8),
        full: formatDay(d),
        value: minutesByDay.get(d) ?? 0,
      });
    }
  }

  const W = 760;
  const H = 210;
  const padL = 44;
  const padR = 8;
  const padT = 14;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const unit = (v: number) => (byTime ? formatMinutes(v) : `${v}`);
  const max = Math.max(byTime ? 60 : 1, ...buckets.map((b) => b.value));
  const slot = plotW / buckets.length;
  const bw = Math.max(3, slot - 2); // 2px surface gap between adjacent bars
  const peak = buckets.reduce((a, b) => (b.value > a.value ? b : a), buckets[0]);

  // Recessive gridlines + axis labels in hours.
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  const grid = ticks
    .map((t) => {
      const y = padT + plotH - (t / max) * plotH;
      return `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="${VIZ.faint}" stroke-width="1"/>
      <text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="${VIZ.muted}">${esc(
        byTime ? (formatMinutes(t) === "—" ? "0" : formatMinutes(t)) : String(t)
      )}</text>`;
    })
    .join("");

  const bars = buckets
    .map((b, i) => {
      const h = (b.value / max) * plotH;
      const x = padL + i * slot;
      const y = padT + plotH - h;
      return `<g><title>${esc(b.full)} — ${esc(unit(b.value))}</title>
      <path d="${barUp(x, y, bw, h)}" fill="${VIZ.s1}"/>
      <rect x="${x}" y="${padT}" width="${bw}" height="${plotH}" fill="transparent"/></g>`;
    })
    .join("");

  // Axis labels: every bucket while they still fit, otherwise just the ends
  // and the peak. (Value labels stay selective regardless — never one per bar.)
  const show =
    buckets.length <= 14
      ? new Set(buckets.map((_, i) => i))
      : new Set([0, buckets.length - 1, buckets.indexOf(peak)]);
  const xLabels = buckets
    .map((b, i) =>
      show.has(i)
        ? `<text x="${padL + i * slot + bw / 2}" y="${H - 10}" text-anchor="middle" font-size="10" fill="${
            VIZ.muted
          }">${esc(b.label)}</text>`
        : ""
    )
    .join("");

  const peakH = (peak.value / max) * plotH;
  const peakLabel =
    peak.value > 0
      ? `<text x="${padL + buckets.indexOf(peak) * slot + bw / 2}" y="${
          padT + plotH - peakH - 6
        }" text-anchor="middle" font-size="10" font-weight="600" fill="${VIZ.ink}">${esc(
          unit(peak.value)
        )}</text>`
      : "";

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Time logged per ${
    weekly ? "week" : "day"
  }">${grid}${bars}${peakLabel}${xLabels}</svg>`;
}

/** Ranked magnitude — one hue, every bar directly labelled. Used for both the
 *  category and module roll-ups: same measure, same encoding, two dimensions. */
function chartRanked(
  input: Array<{ name: string; entries: number; minutes: number }>,
  ariaLabel: string,
  byTime: boolean
): string {
  const measure = (c: { entries: number; minutes: number }) =>
    byTime ? c.minutes : c.entries;
  const all = input
    .map((c) => ({ category: c.name, entries: c.entries, minutes: c.minutes }))
    .filter((c) => measure(c) > 0)
    .sort((a, b) => measure(b) - measure(a));
  if (all.length === 0) return "";
  // Past eight slots the palette folds to "Other" rather than inventing hues;
  // here it's one hue anyway, but the cap keeps the chart readable.
  const top = all.slice(0, 8);
  const rest = all.slice(8);
  const rows = [...top];
  if (rest.length > 0) {
    rows.push({
      category: `Other (${rest.length})`,
      entries: rest.reduce((s, c) => s + c.entries, 0),
      minutes: rest.reduce((s, c) => s + c.minutes, 0),
    });
  }

  const W = 760;
  const rowH = 30;
  const H = rows.length * rowH + 6;
  const labelW = 150;
  const valueW = 70;
  const plotW = W - labelW - valueW;
  const max = Math.max(...rows.map(measure));

  const bars = rows
    .map((c, i) => {
      const y = i * rowH + 4;
      const w = Math.max(2, (measure(c) / max) * plotW);
      return `<g><title>${esc(c.category)} — ${
        byTime ? esc(formatMinutes(c.minutes)) : ""
      }${byTime ? " over " : ""}${c.entries} task${c.entries === 1 ? "" : "s"}</title>
      <text x="${labelW - 10}" y="${y + 15}" text-anchor="end" font-size="12" fill="${
        VIZ.ink
      }">${esc(c.category)}</text>
      <path d="${barRight(labelW, y + 3, w, 18)}" fill="${VIZ.s1}"/>
      <text x="${labelW + w + 8}" y="${y + 16}" font-size="11" font-weight="600" fill="${
        VIZ.muted
      }">${esc(byTime ? formatMinutes(c.minutes) : String(c.entries))}</text></g>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(
    ariaLabel
  )}">${bars}</svg>`;
}

/** Composition of the period's work. Neutral categorical hues — these are
 *  states of work, not grades, so the reserved status palette stays out. */
function chartBreakdown(r: ReportData): string {
  const colors = statusColors(r);
  const used = r.totals.byStatus
    .map((st) => ({
      label: st.positiveLabel,
      value: st.count,
      color: colors.get(st.key) ?? SERIES[0],
    }))
    .filter((p) => p.value > 0);

  // Never invent a hue past the palette: a ninth series folds into "Other"
  // rather than reusing slot 8 and making two states look identical.
  const parts =
    used.length <= SERIES.length
      ? used
      : [
          ...used.slice(0, SERIES.length - 1),
          {
            label: `Other (${used.length - (SERIES.length - 1)})`,
            value: used
              .slice(SERIES.length - 1)
              .reduce((sum, p) => sum + p.value, 0),
            color: SERIES[SERIES.length - 1],
          },
        ];
  if (parts.length === 0) return "";

  const total = parts.reduce((s, p) => s + p.value, 0);
  const W = 760;
  const H = 54;
  const gap = 2; // 2px surface gap between adjacent fills
  const usable = W - gap * (parts.length - 1);

  let x = 0;
  const segs = parts
    .map((p) => {
      const w = (p.value / total) * usable;
      const seg = `<g><title>${esc(p.label)} — ${p.value} task${
        p.value === 1 ? "" : "s"
      }</title><rect x="${x}" y="0" width="${w}" height="26" rx="4" fill="${p.color}"/>${
        // Relief rule: a visible number inside every segment wide enough to
        // hold one, so identity never rests on hue alone.
        w > 26
          ? `<text x="${x + w / 2}" y="18" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${
              p.value
            }</text>`
          : ""
      }</g>`;
      x += w + gap;
      return seg;
    })
    .join("");

  // Legend is always present for >= 2 series.
  let lx = 0;
  const legend = parts
    .map((p) => {
      const text = `${p.label} · ${p.value}`;
      const item = `<g transform="translate(${lx} 42)"><rect width="10" height="10" rx="2" fill="${
        p.color
      }"/><text x="16" y="9" font-size="11" fill="${VIZ.muted}">${esc(text)}</text></g>`;
      lx += 26 + text.length * 6.1;
      return item;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Work breakdown by state">${segs}${legend}</svg>`;
}

export function renderVisualHtml(r: ReportData, fields: ReportFields = ALL_FIELDS): string {
  const { meta, days, totals } = r;
  const period = `${formatDay(meta.from)} — ${formatDay(meta.to)}`;
  const activeDays = totals.daysWorked;
  const avg = activeDays > 0 ? Math.round(totals.minutes / activeDays) : 0;
  const namedModules = totals.byModule.filter((m) => m.module !== "Unassigned").length;
  const colors = statusColors(r);

  // Most substantial pieces of work, by time invested.
  const highlights = (fields.minutes ? days : [])
    .flatMap((d) => d.entries.map((e) => ({ ...e, day: d.day })))
    .filter((e) => (e.minutes ?? 0) > 0)
    .sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0))
    .slice(0, 3);

  const tile = (k: string, v: string, sub = "") =>
    `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${
      sub ? `<div class="s">${esc(sub)}</div>` : ""
    }</div>`;

  const daySections = groupsFor(r, fields)
    .map(
      (d) => `<section class="day">
      ${d.day === null ? "" : `<h3><span>${esc(formatDay(d.day))}</span>${
        fields.minutes ? `<span class="t">${esc(formatMinutes(d.minutes))}</span>` : ""
      }</h3>`}
      ${d.entries
        .map(
          (e) => `<div class="entry">
        <div class="eh">${fields.title ? `<span class="title">${esc(e.title)}</span>` : ""}${
            fields.module && e.module ? `<span class="mod">${esc(e.module)}</span>` : ""
          }${
            fields.category && e.category ? `<span class="tag">${esc(e.category)}</span>` : ""
          }${
            fields.status
              ? `<span class="st" style="background:${colors.get(e.statusKey)}">${esc(
                  e.statusLabelPositive ?? e.statusLabel
                )}</span>`
              : ""
          }${
            fields.minutes
              ? `<span class="mins">${esc(formatMinutes(e.minutes))}</span>`
              : ""
          }</div>
        ${fields.details && e.details ? `<p>${esc(e.details)}</p>` : ""}
      </div>`
        )
        .join("")}
    </section>`
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Work report — ${esc(period)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; padding:40px 28px; background:${VIZ.surface}; color:${VIZ.ink};
         font:14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 820px; margin: 0 auto; }
  .head { border-bottom: 3px solid ${VIZ.s1}; padding-bottom: 14px; margin-bottom: 24px; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .sub { color:${VIZ.muted}; margin:0; }
  .tiles { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin: 22px 0 30px; }
  .tile { border:1px solid ${VIZ.faint}; border-radius:10px; padding:14px; background:#fff; }
  .tile .k { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:${VIZ.muted}; }
  .tile .v { font-size:24px; font-weight:700; margin-top:4px; letter-spacing:-0.02em; }
  .tile .s { font-size:11px; color:${VIZ.muted}; margin-top:2px; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.07em; color:${VIZ.muted};
       margin:30px 0 10px; }
  .card { border:1px solid ${VIZ.faint}; border-radius:10px; padding:16px; background:#fff; }
  .hl { display:grid; gap:8px; }
  .hl .row { display:flex; align-items:baseline; gap:10px; border-left:3px solid ${VIZ.s1};
             padding:6px 0 6px 12px; }
  .hl .n { font-weight:600; }
  .hl .m { margin-left:auto; color:${VIZ.muted}; font-variant-numeric:tabular-nums; }
  .day { margin-bottom:18px; page-break-inside:avoid; }
  .day h3 { display:flex; justify-content:space-between; font-size:13px; margin:0 0 8px;
            padding-bottom:6px; border-bottom:1px solid ${VIZ.faint}; }
  .day h3 .t { font-weight:400; color:${VIZ.muted}; font-variant-numeric:tabular-nums; }
  .entry { padding:6px 0 6px 12px; border-left:3px solid ${VIZ.faint}; margin-bottom:8px;
           page-break-inside:avoid; }
  .eh { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
  .title { font-weight:600; }
  .mins { margin-left:auto; color:${VIZ.muted}; font-variant-numeric:tabular-nums; }
  .tag { font-size:11px; padding:1px 7px; border-radius:999px; background:#f2f2f0; color:${VIZ.muted}; }
  .mod { font-size:11px; padding:1px 7px; border-radius:999px; background:#e7effc; color:#184f95;
         font-weight:600; }
  .st { font-size:11px; padding:1px 7px; border-radius:999px; color:#fff; }
  .entry p { margin:6px 0 0; color:#3f3f46; white-space:pre-wrap; font-size:13px; }
  footer { margin-top:30px; padding-top:12px; border-top:1px solid ${VIZ.faint};
           color:#a1a1aa; font-size:11px; }
  .tablewrap { overflow-x:auto; }
  table.grid { width:100%; border-collapse:collapse; font-size:13px; }
  table.grid th { background:#f4f4f5; font-size:10px; text-transform:uppercase;
                  letter-spacing:.06em; color:${VIZ.muted}; white-space:nowrap; }
  table.grid th, table.grid td { border:1px solid ${VIZ.faint}; padding:6px 8px;
                                 text-align:left; vertical-align:top; }
  table.grid td.wrap { white-space:pre-wrap; min-width:16rem; }
  table.grid tr { page-break-inside:avoid; }
  @media print { body { padding:0; background:#fff; } .card,.tile { break-inside:avoid; } }
  @media (max-width:640px) { .tiles { grid-template-columns:repeat(2,1fr); } body { padding:20px 14px; } }
</style></head>
<body><div class="wrap">
  <div class="head">
    <h1>Work report</h1>
    <p class="sub">${esc(period)}${meta.author ? ` · ${esc(meta.author)}` : ""}</p>
  </div>

  <div class="tiles">
    ${
      fields.status
        ? tile("Tasks completed", String(totals.doneCount))
        : tile("Tasks", String(totals.entries))
    }
    ${fields.minutes ? tile("Time invested", formatMinutes(totals.minutes)) : ""}
    ${
      fields.date
        ? tile(
            "Active days",
            String(activeDays),
            fields.minutes && avg > 0 ? `${formatMinutes(avg)} avg` : ""
          )
        : ""
    }
    ${
      // Lead with modules once they're in use, otherwise keep the original
      // focus-area tile — never label a category count as a module count.
      fields.module && namedModules > 1
        ? tile(
            "Modules touched",
            String(namedModules),
            `${totals.byCategory.length} focus area${
              totals.byCategory.length === 1 ? "" : "s"
            }`
          )
        : fields.category
        ? tile("Focus areas", String(totals.byCategory.length))
        : ""
    }
  </div>

  ${
    days.length === 0
      ? '<p style="color:#71717a;font-style:italic">No work logged in this period.</p>'
      : `
  ${
    // Activity measures time when time is included and task counts otherwise,
    // so it survives either way — but it is plotted over days, so the date
    // field has to be in.
    fields.date
      ? `<h2>Activity across the period</h2>
  <div class="card">${chartActivity(r, fields.minutes)}</div>`
      : ""
  }

  ${
    fields.category
      ? `<h2>${fields.minutes ? "Where the time went" : "By category"}</h2>
  <div class="card">${chartRanked(
    totals.byCategory.map((c) => ({ name: c.category, ...c })),
    fields.minutes ? "Time by category" : "Tasks by category",
    fields.minutes
  )}</div>`
      : ""
  }

  ${
    // One module is a single bar that says nothing — the section earns its
    // place only once the work spans more than one.
    fields.module && namedModules > 1
      ? `<h2>Modules touched</h2>
  <div class="card">${chartRanked(
    totals.byModule.map((m) => ({ name: m.module, ...m })),
    fields.minutes ? "Time by module" : "Tasks by module",
    fields.minutes
  )}</div>`
      : ""
  }

  ${
    fields.status
      ? `<h2>Work breakdown</h2>
  <div class="card">${chartBreakdown(r)}</div>`
      : ""
  }

  ${
    highlights.length > 0
      ? `<h2>Highlights</h2>
  <div class="card hl">${highlights
    .map(
      (h) =>
        `<div class="row">${fields.title ? `<span class="n">${esc(h.title)}</span>` : ""}${
          fields.module && h.module ? `<span class="mod">${esc(h.module)}</span>` : ""
        }${fields.category && h.category ? `<span class="tag">${esc(h.category)}</span>` : ""}<span class="m">${esc(formatMinutes(h.minutes))}</span></div>`
    )
    .join("")}</div>`
      : ""
  }

  ${
    daySections
      ? `<h2>${fields.date ? "Daily log" : "All items"}</h2>
  ${daySections}`
      : ""
  }

  ${TABLE_TYPES.map((t) => tableSectionHtml(r, t, fields, "card tablewrap")).join("\n  ")}`
  }

  <footer>Generated ${esc(new Date().toLocaleString("en-GB"))} · DailyWork</footer>
</div></body></html>`;
}

export function renderMarkdown(r: ReportData, fields: ReportFields = ALL_FIELDS): string {
  const { meta, days, totals } = r;
  const out: string[] = [];
  out.push(`# Work report`);
  out.push("");
  out.push(`**Period:** ${formatDay(meta.from)} — ${formatDay(meta.to)}`);
  if (meta.author) out.push(`**By:** ${meta.author}`);
  out.push("");
  out.push(
    `**${totals.entries}** tasks across **${totals.daysWorked}** day(s) · **${formatMinutes(
      totals.minutes
    )}** logged · ${totals.doneCount} completed${totals.byStatus
      .filter((st) => !st.done && st.count > 0)
      .map((st) => `, ${st.count} ${st.label.toLowerCase()}`)
      .join("")}`
  );
  out.push("");

  if (fields.category && totals.byCategory.length > 0) {
    out.push("## By category");
    out.push("");
    out.push("| Category | Tasks | Time |");
    out.push("| --- | ---: | ---: |");
    for (const c of totals.byCategory) {
      out.push(`| ${c.category} | ${c.entries} | ${formatMinutes(c.minutes)} |`);
    }
    out.push("");
  }

  if (fields.module && totals.byModule.length > 0) {
    out.push("## By module");
    out.push("");
    out.push("| Module | Tasks | Time |");
    out.push("| --- | ---: | ---: |");
    for (const m of totals.byModule) {
      out.push(`| ${m.module} | ${m.entries} | ${formatMinutes(m.minutes)} |`);
    }
    out.push("");
  }

  out.push(fields.date ? "## Daily breakdown" : "## All items");
  out.push("");
  if (days.length === 0) {
    out.push("_No work logged in this period._");
  }
  for (const d of groupsFor(r, fields)) {
    if (d.day !== null) {
      out.push(
        fields.minutes
          ? `### ${formatDay(d.day)} — ${formatMinutes(d.minutes)}`
          : `### ${formatDay(d.day)}`
      );
      out.push("");
    }
    for (const e of d.entries) {
      const bits: string[] = [];
      if (fields.status) bits.push(e.statusLabel);
      if (fields.module && e.module) bits.push(e.module);
      if (fields.category && e.category) bits.push(e.category);
      if (fields.minutes && e.minutes) bits.push(formatMinutes(e.minutes));
      const name = fields.title ? `**${e.title}**` : "";
      const meta = bits.length > 0 ? `_(${bits.join(" · ")})_` : "";
      out.push(`- ${[name, meta].filter(Boolean).join(" ")}`.trimEnd());
      if (fields.details && e.details) {
        // Indent so multi-line details stay inside the list item.
        for (const line of e.details.split("\n")) out.push(`  ${line}`);
      }
    }
    out.push("");
  }
  for (const type of TABLE_TYPES) {
    const rows = itemsOfType(r, type);
    const cols = tableColumns(fields);
    if (rows.length === 0 || cols.length === 0) continue;
    out.push("");
    out.push(`## ${ENTRY_TYPE_LABEL[type]}`);
    out.push("");
    out.push(`| ${cols.map((c) => c.label).join(" | ")} |`);
    out.push(`| ${cols.map(() => "---").join(" | ")} |`);
    for (const e of rows) {
      // Pipes and newlines would break the table, so they are neutralised.
      const cells = cols.map((c) =>
        cellText(e, c.key).replace(/\|/g, "\\|").replace(/\n/g, "<br>")
      );
      out.push(`| ${cells.join(" | ")} |`);
    }
  }

  return out.join("\n");
}

export function renderCsvRows(
  r: ReportData,
  fields: ReportFields = ALL_FIELDS
): Array<Record<string, unknown>> {
  // Not `groupsFor` — that is the prose subset. A spreadsheet export has to
  // carry every record regardless of type; the `type` column disambiguates.
  return r.days.flatMap((d) =>
    d.entries.map((e) => ({
      type: ENTRY_TYPE_LABEL_ONE[e.entryType],
      ...(fields.date ? { date: e.day } : {}),
      ...(fields.title ? { title: e.title } : {}),
      ...(fields.module ? { module: e.module ?? "" } : {}),
      ...(fields.category ? { category: e.category ?? "" } : {}),
      ...(fields.status ? { status: e.statusLabel } : {}),
      ...(fields.minutes
        ? { minutes: e.minutes ?? "", time: formatMinutes(e.minutes) }
        : {}),
      ...(fields.details ? { details: e.details ?? "" } : {}),
    }))
  );
}

/** Column order, narrowed to the chosen fields so the header matches rows. */
function csvColumns(fields: ReportFields): string[] {
  return [
    "type",
    ...(fields.date ? ["date"] : []),
    ...(fields.title ? ["title"] : []),
    ...(fields.module ? ["module"] : []),
    ...(fields.category ? ["category"] : []),
    ...(fields.status ? ["status"] : []),
    ...(fields.minutes ? ["minutes", "time"] : []),
    ...(fields.details ? ["details"] : []),
  ];
}

/** Hand-laid PDF. jsPDF has no layout engine, so every block measures its own
 *  height and asks for a page break before it would run past the bottom. */
export async function renderPdf(
  r: ReportData,
  fields: ReportFields = ALL_FIELDS
): Promise<jsPDF> {
  const { jsPDF: JsPDF } = await import("jspdf");
  const doc = new JsPDF({ unit: "pt", format: "a4" });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const M = 48;
  const W = PAGE_W - M * 2;
  let y = M;

  const need = (h: number) => {
    if (y + h > PAGE_H - M) {
      doc.addPage();
      y = M;
    }
  };
  const text = (
    s: string,
    size: number,
    style: "normal" | "bold" = "normal",
    color: [number, number, number] = [24, 24, 27],
    indent = 0
  ) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(s, W - indent) as string[];
    const lh = size * 1.35;
    need(lines.length * lh);
    doc.text(lines, M + indent, y);
    y += lines.length * lh;
  };

  const { meta, days, totals } = r;

  text("Work report", 20, "bold");
  y += 2;
  text(`${formatDay(meta.from)} — ${formatDay(meta.to)}`, 11, "normal", [82, 82, 91]);
  if (meta.author) text(meta.author, 11, "normal", [82, 82, 91]);
  y += 10;

  text(
    `${totals.entries} tasks · ${totals.daysWorked} day(s) · ${formatMinutes(
      totals.minutes
    )} logged · ${totals.doneCount} completed${totals.byStatus
      .filter((st) => !st.done && st.count > 0)
      .map((st) => `, ${st.count} ${st.label.toLowerCase()}`)
      .join("")}`,
    10,
    "normal",
    [63, 63, 70]
  );
  y += 12;

  if (fields.category && totals.byCategory.length > 0) {
    text("BY CATEGORY", 9, "bold", [113, 113, 122]);
    y += 2;
    for (const c of totals.byCategory) {
      need(16);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(24, 24, 27);
      doc.text(c.category, M, y);
      doc.text(String(c.entries), M + W - 120, y, { align: "right" });
      doc.text(formatMinutes(c.minutes), M + W, y, { align: "right" });
      y += 15;
    }
    y += 8;
  }

  text(fields.date ? "DAILY BREAKDOWN" : "ALL ITEMS", 9, "bold", [113, 113, 122]);
  y += 4;

  if (days.length === 0) {
    text("No work logged in this period.", 10, "normal", [113, 113, 122]);
  }

  for (const d of groupsFor(r, fields)) {
    if (d.day !== null) {
      need(34);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(24, 24, 27);
      doc.text(formatDay(d.day), M, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(82, 82, 91);
      if (fields.minutes) doc.text(formatMinutes(d.minutes), M + W, y, { align: "right" });
      y += 6;
      doc.setDrawColor(24, 24, 27);
      doc.setLineWidth(1);
      doc.line(M, y, M + W, y);
      y += 14;
    }

    for (const e of d.entries) {
      const bits: string[] = [];
      if (fields.status) bits.push(e.statusLabel);
      if (fields.module && e.module) bits.push(e.module);
      if (fields.category && e.category) bits.push(e.category);
      if (fields.minutes && e.minutes) bits.push(formatMinutes(e.minutes));
      if (fields.title) text(e.title, 10.5, "bold", [24, 24, 27], 10);
      if (bits.length > 0) text(bits.join("  ·  "), 9, "normal", [113, 113, 122], 10);
      if (fields.details && e.details) text(e.details, 9.5, "normal", [63, 63, 70], 10);
      y += 8;
    }
    y += 6;
  }

  // Tabular types: a simple grid. jsPDF has no table engine, so columns get
  // fixed widths and cells are clipped to one line — except details, which
  // wraps onto continuation lines beneath its row.
  for (const type of TABLE_TYPES) {
    const rows = itemsOfType(r, type);
    const cols = tableColumns(fields).filter((c) => c.key !== "details");
    if (rows.length === 0) continue;
    const wantDetails = fields.details;

    y += 14;
    text(ENTRY_TYPE_LABEL[type].toUpperCase(), 9, "bold", [113, 113, 122]);
    y += 4;

    const colW = W / Math.max(1, cols.length);
    const clip = (str: string, w: number) => {
      const lines = doc.splitTextToSize(str, w - 6) as string[];
      return lines[0] ?? "";
    };

    const header = () => {
      need(20);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(82, 82, 91);
      cols.forEach((c, i) => doc.text(c.label, M + i * colW + 2, y));
      y += 4;
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.5);
      doc.line(M, y, M + W, y);
      y += 10;
    };
    header();

    for (const e of rows) {
      need(wantDetails && e.details ? 34 : 18);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(24, 24, 27);
      cols.forEach((c, i) =>
        doc.text(clip(cellText(e, c.key), colW), M + i * colW + 2, y)
      );
      y += 12;
      if (wantDetails && e.details) {
        text(e.details, 8.5, "normal", [113, 113, 122], 8);
        y += 4;
      }
      doc.setDrawColor(230, 230, 230);
      doc.line(M, y - 6, M + W, y - 6);
    }
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(161, 161, 170);
    doc.text(`DailyWork · page ${p} of ${pages}`, PAGE_W / 2, PAGE_H - 24, {
      align: "center",
    });
  }
  return doc;
}

/** Serialize + trigger the download for the chosen format. Async because the
 *  PDF renderer loads jsPDF on demand. */
export async function downloadReport(
  r: ReportData,
  format: ReportFormat,
  fields: ReportFields = ALL_FIELDS
): Promise<void> {
  const name = `work-report-${r.meta.from}_to_${r.meta.to}`;
  switch (format) {
    case "visual":
      downloadFile(`${name}-visual.html`, renderVisualHtml(r, fields), "text/html;charset=utf-8");
      return;
    case "html":
      downloadFile(`${name}.html`, renderHtml(r, fields), "text/html;charset=utf-8");
      return;
    case "md":
      downloadFile(`${name}.md`, renderMarkdown(r, fields), "text/markdown;charset=utf-8");
      return;
    case "csv":
      downloadFile(
        `${name}.csv`,
        toCSV(renderCsvRows(r, fields), csvColumns(fields)),
        "text/csv;charset=utf-8"
      );
      return;
    case "pdf":
      (await renderPdf(r, fields)).save(`${name}.pdf`);
      return;
  }
}
