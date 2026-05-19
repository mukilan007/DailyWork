// Best-effort bank-statement PDF parser. Runs entirely in the browser via
// `pdfjs-dist`, which is loaded with a dynamic import so it stays out of the
// initial route bundle. The parser is regex-based and tries to be tolerant of
// the wildly different layouts produced by Indian banks (HDFC, ICICI, SBI,
// Axis, Kotak, ...). If a line doesn't look like a transaction, we skip it.

export interface ParsedRow {
  /** YYYY-MM-DD (local) — the transaction's value/posting date. */
  occurred_on: string;
  /** Cleaned-up narration / merchant text. */
  description: string;
  kind: "income" | "expense";
  amount_paise: number;
  /** Original line text, kept around so users can debug a misparse. */
  raw: string;
}

export interface DetectedAccountInfo {
  /** Best-effort bank name pulled from the statement header (e.g. "HDFC Bank"). */
  bankName: string | null;
  /** Last visible digits of the account number, masked or otherwise (e.g. "1234"). */
  accountNumberSuffix: string | null;
  /** Combined human-readable suggestion (e.g. "HDFC Bank • ****1234"). */
  suggestedName: string | null;
  /** Best-effort `account_type` guess: savings / card / account / other. */
  suggestedType: "savings" | "card" | "account" | "other";
}

/** Quick scan over the first ~40 lines of the statement to pull out a sensible
 *  default account name & type so the user doesn't have to type one when
 *  importing for the first time. Conservative: returns nulls if unsure. */
export function detectAccountInfo(rawText: string): DetectedAccountInfo {
  const head = rawText
    .split(/\r?\n/)
    .slice(0, 40)
    .join(" \n ")
    .toLowerCase();

  // Bank name detection — checked in order of specificity.
  const banks: Array<[string, string]> = [
    ["hdfc", "HDFC Bank"],
    ["icici", "ICICI Bank"],
    ["state bank of india", "SBI"],
    ["sbi", "SBI"],
    ["axis", "Axis Bank"],
    ["kotak", "Kotak Bank"],
    ["yes bank", "Yes Bank"],
    ["indusind", "IndusInd Bank"],
    ["punjab national", "PNB"],
    ["bank of baroda", "Bank of Baroda"],
    ["canara", "Canara Bank"],
    ["union bank", "Union Bank"],
    ["idfc", "IDFC First"],
    ["rbl", "RBL Bank"],
    ["citi", "Citi Bank"],
    ["hsbc", "HSBC"],
    ["standard chartered", "Standard Chartered"],
  ];
  let bankName: string | null = null;
  for (const [needle, label] of banks) {
    if (head.includes(needle)) {
      bankName = label;
      break;
    }
  }

  // Account-number suffix: prefer masked patterns like "xxxxxx1234" / "****1234"
  // and fall back to the last 4 digits of any 9+ digit run.
  let suffix: string | null = null;
  const maskedMatch = head.match(/[x*•·]{2,}\s*(\d{4})/);
  if (maskedMatch) suffix = maskedMatch[1];
  if (!suffix) {
    const longNum = head.match(/\b(\d{9,18})\b/);
    if (longNum) suffix = longNum[1].slice(-4);
  }

  // Type guess: prefer 'card' if 'credit card' appears; 'savings' if 'savings'
  // appears; otherwise generic 'account'.
  let suggestedType: "savings" | "card" | "account" | "other" = "account";
  if (/credit\s*card|card\s*statement|card\s*no/.test(head)) suggestedType = "card";
  else if (/savings/.test(head)) suggestedType = "savings";

  const suggestedName =
    bankName && suffix
      ? `${bankName} ••${suffix}`
      : bankName ?? (suffix ? `Account ••${suffix}` : null);

  return { bankName, accountNumberSuffix: suffix, suggestedName, suggestedType };
}

// ---------------------------------------------------------------------------
// File → plain text (dispatcher for PDF / CSV / TXT)
// ---------------------------------------------------------------------------

/** Browser MIME / extension list of formats the importer accepts. Kept here
 *  so the dialog's `accept=` attribute and the actual dispatcher stay in sync.
 *  Images go through Tesseract.js OCR — slower and less accurate than PDF/CSV
 *  but useful for one-off screenshots. */
export const ACCEPTED_STATEMENT_FORMATS =
  ".pdf,.csv,.txt,.png,.jpg,.jpeg,.webp,.bmp," +
  "application/pdf,text/csv,text/plain," +
  "image/png,image/jpeg,image/webp,image/bmp";

/** Coarse progress callback passed all the way down to the OCR engine so the
 *  dialog can show "OCR'ing image… 42%" instead of staring at a spinner. */
export type StatementExtractProgress = (info: {
  stage: "ocr";
  /** 0..1 */
  progress: number;
}) => void;

export type StatementFormat = "pdf" | "csv" | "txt" | "image" | "unknown";

/** Single source of truth for "what kind of statement is this File?". Used by
 *  the dispatcher below and by the import dialog (so it can pick the right
 *  progress message / error copy without re-implementing the same checks). */
export function detectStatementFormat(file: File): StatementFormat {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".csv") || type === "text/csv") return "csv";
  if (type.startsWith("image/") || /\.(png|jpe?g|webp|bmp)$/i.test(name)) {
    return "image";
  }
  if (
    name.endsWith(".txt") ||
    type === "text/plain" ||
    type.startsWith("text/")
  ) {
    return "txt";
  }
  return "unknown";
}

/**
 * Extract a single text blob from a supported statement `File`. Throws if the
 * format can't be handled (e.g. a password-protected PDF, or a binary format
 * like .xlsx we don't have a parser for).
 */
export async function extractStatementText(
  file: File,
  onProgress?: StatementExtractProgress
): Promise<string> {
  switch (detectStatementFormat(file)) {
    case "pdf":
      return extractPdfText(file);
    case "csv":
      // Convert CSV rows to whitespace-separated lines so the regex parser
      // sees them the same shape as PDF rows (date, narration, amount).
      return csvToPlainText(await file.text());
    case "image":
      return extractImageText(file, onProgress);
    case "txt":
      return file.text();
    case "unknown":
      throw new Error(
        `Unsupported file type "${file.type || file.name.split(".").pop() || "unknown"}". Upload a PDF, CSV, TXT, or image statement.`
      );
  }
}

/** OCR a bank-statement screenshot via Tesseract.js. Dynamically imported so
 *  the ~2 MB engine + language data only download when the user actually
 *  picks an image. Accuracy on tabular layouts is mediocre — users typically
 *  need to fix a few rows in the review step. */
async function extractImageText(
  file: File,
  onProgress?: StatementExtractProgress
): Promise<string> {
  const { recognize } = await import("tesseract.js");
  const result = await recognize(file, "eng", {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress({ stage: "ocr", progress: m.progress });
      }
    },
  });
  return result.data.text ?? "";
}

/** Minimal RFC-4180-ish CSV → space-joined text. Handles quoted fields and
 *  doubled-quote escapes. Cells are joined with two spaces so the parser's
 *  greedy whitespace splits behave well. */
function csvToPlainText(csv: string): string {
  const cleaned = csv.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        cols.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    out.push(cols.filter(Boolean).join("  "));
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// PDF → plain text
// ---------------------------------------------------------------------------

/**
 * Extract a single text blob from a PDF `File`. Pages are joined with `\n\n`.
 * Items inside a page are joined with newlines when the next item is on a new
 * visual line (detected via the `hasEOL` flag PDF.js exposes) and with a
 * space otherwise — that gives us reasonably reliable per-line strings to
 * feed to the parser.
 *
 * Throws on password-protected or otherwise unreadable PDFs.
 */
export async function extractPdfText(file: File): Promise<string> {
  // Dynamic import — keeps pdfjs (~300 KB) out of the initial bundle.
  const pdfjs = await import("pdfjs-dist");
  // Vite resolves this `new URL(...)` to a hashed asset URL at build time.
  // The worker is shipped as a real file rather than inlined so it stays a
  // separate, cacheable resource.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pdfjs as any).GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let line = "";
    const lines: string[] = [];
    for (const item of tc.items as Array<{ str: string; hasEOL?: boolean }>) {
      line += (line && !line.endsWith(" ") ? " " : "") + item.str;
      if (item.hasEOL) {
        if (line.trim()) lines.push(line.trim());
        line = "";
      }
    }
    if (line.trim()) lines.push(line.trim());
    pages.push(lines.join("\n"));
  }
  await doc.destroy();
  return pages.join("\n\n");
}

// ---------------------------------------------------------------------------
// Statement text → ParsedRow[]
// ---------------------------------------------------------------------------

// Match a date at the start of a line. Captures groups depend on the format:
//   DD/MM/YYYY, DD-MM-YYYY  → day, mon, year (4-digit)
//   DD/MM/YY,   DD-MM-YY    → day, mon, year (2-digit, treated as 2000+)
//   DD MMM YYYY              → day, monName, year
//   YYYY-MM-DD               → year, mon, day
const DATE_PATTERNS: Array<{ re: RegExp; build: (m: RegExpExecArray) => string | null }> = [
  {
    re: /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/,
    build: (m) => normaliseYMD(+m[3], +m[2], +m[1]),
  },
  {
    re: /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})\b/,
    build: (m) => normaliseYMD(2000 + +m[3], +m[2], +m[1]),
  },
  {
    re: /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/,
    build: (m) => {
      const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
      return mon ? normaliseYMD(+m[3], mon, +m[1]) : null;
    },
  },
  {
    re: /^(\d{4})-(\d{2})-(\d{2})\b/,
    build: (m) => normaliseYMD(+m[1], +m[2], +m[3]),
  },
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function normaliseYMD(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Indian-style money: 1,23,456.78 or 123456.78. The `\.\d{2}` decimal part is
// required — that's how we distinguish amounts from reference numbers and
// dates that may also appear on the line.
const AMOUNT_RE = /-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}/g;

/** Convert an amount string ("1,23,456.78" / "-5,000.00") to paise. */
function amountToPaise(s: string): number {
  const negative = s.trim().startsWith("-");
  const clean = s.replace(/[,\s-]/g, "");
  const n = Number.parseFloat(clean);
  if (!Number.isFinite(n)) return 0;
  const paise = Math.round(n * 100);
  return negative ? -paise : paise;
}

/** Strip a leading date token from a line, leaving the rest of the line. */
function stripLeadingDate(line: string): string {
  for (const { re } of DATE_PATTERNS) {
    const m = re.exec(line);
    if (m) return line.slice(m[0].length).trim();
  }
  return line;
}

/**
 * Parse one date-prefixed line into a `ParsedRow`. Returns `null` if the line
 * doesn't look like a real transaction (e.g. opening balance, page number,
 * header that happens to start with a date-like number).
 *
 * Strategy:
 *  1. Identify the date at the start of the line.
 *  2. Find every `xx.xx` amount on the line.
 *  3. The last one is treated as the running balance (and dropped).
 *  4. The remaining amount(s) become the transaction amount:
 *     - If a `Dr`/`Cr` marker is attached to the amount, use it.
 *     - If two amounts remain (separate debit + credit columns), the
 *       non-zero one wins.
 *     - Otherwise fall back to a balance-delta sanity check.
 *  5. Description = everything between the date and the first amount,
 *     trimmed of noise (UTR/ref strings get truncated for display).
 */
function parseLine(
  line: string,
  prevBalancePaise: number | null
): { row: ParsedRow | null; balancePaise: number | null } {
  let dateStr: string | null = null;
  for (const { re, build } of DATE_PATTERNS) {
    const m = re.exec(line);
    if (m) {
      dateStr = build(m);
      break;
    }
  }
  if (!dateStr) return { row: null, balancePaise: prevBalancePaise };

  // Collect all amount matches with their positions.
  const amounts: Array<{ start: number; end: number; text: string; marker?: "dr" | "cr" }> = [];
  AMOUNT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_RE.exec(line))) {
    // Look for an immediately-following Dr/Cr marker (allow a space or `.`).
    const tail = line.slice(m.index + m[0].length, m.index + m[0].length + 4).toLowerCase();
    let marker: "dr" | "cr" | undefined;
    if (/^\s*cr\b/.test(tail)) marker = "cr";
    else if (/^\s*dr\b/.test(tail)) marker = "dr";
    amounts.push({ start: m.index, end: m.index + m[0].length, text: m[0], marker });
  }

  if (amounts.length === 0) return { row: null, balancePaise: prevBalancePaise };

  // Last amount → running balance.
  const balance = amounts[amounts.length - 1];
  const balancePaise = amountToPaise(balance.text);
  const txAmounts = amounts.slice(0, -1);
  if (txAmounts.length === 0) {
    // Likely an opening-balance / closing-balance row — skip but track balance.
    return { row: null, balancePaise };
  }

  // Pick the transaction amount + kind.
  let kind: "income" | "expense" = "expense";
  let amountPaise = 0;
  const dr = txAmounts.find((a) => a.marker === "dr");
  const cr = txAmounts.find((a) => a.marker === "cr");

  if (dr) {
    amountPaise = Math.abs(amountToPaise(dr.text));
    kind = "expense";
  } else if (cr) {
    amountPaise = Math.abs(amountToPaise(cr.text));
    kind = "income";
  } else if (txAmounts.length >= 2) {
    // Two-column layout (Debit | Credit). The non-zero one wins.
    // Typically the rightmost amount is the credit; bank layouts that put
    // debit on the right are rare. If both look non-zero, prefer the one
    // consistent with balance delta.
    const last = txAmounts[txAmounts.length - 1];
    const prev = txAmounts[txAmounts.length - 2];
    const lastPaise = Math.abs(amountToPaise(last.text));
    const prevPaise = Math.abs(amountToPaise(prev.text));
    if (lastPaise > 0 && prevPaise === 0) {
      amountPaise = lastPaise;
      kind = "income";
    } else if (prevPaise > 0 && lastPaise === 0) {
      amountPaise = prevPaise;
      kind = "expense";
    } else if (prevBalancePaise !== null) {
      const delta = balancePaise - prevBalancePaise;
      amountPaise = Math.abs(delta) || lastPaise || prevPaise;
      kind = delta >= 0 ? "income" : "expense";
    } else {
      amountPaise = lastPaise || prevPaise;
      kind = "expense";
    }
  } else {
    // Single amount, no marker: rely on balance delta if we have one.
    const only = txAmounts[0];
    const raw = amountToPaise(only.text);
    amountPaise = Math.abs(raw);
    if (raw < 0) {
      // Explicit negative → refund / credit.
      kind = "income";
    } else if (prevBalancePaise !== null) {
      kind = balancePaise >= prevBalancePaise ? "income" : "expense";
    } else {
      kind = "expense";
    }
  }

  if (amountPaise === 0) return { row: null, balancePaise };

  // Description: everything between the date and the first amount.
  const firstAmountStart = amounts[0].start;
  const afterDate = stripLeadingDate(line.slice(0, firstAmountStart)).trim();
  const description = cleanDescription(afterDate);
  if (!description) return { row: null, balancePaise };

  return {
    row: {
      occurred_on: dateStr,
      description,
      kind,
      amount_paise: amountPaise,
      raw: line,
    },
    balancePaise,
  };
}

/** Collapse whitespace + drop obvious noise tokens for nicer display. */
function cleanDescription(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\b(?:ref(?:erence)?\s*no\.?\s*:?\s*[\w-]+)/gi, "")
    .replace(/\b(?:utr\s*:?\s*[\w-]+)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Drop lines that we know aren't transactions. */
function isNoiseLine(line: string): boolean {
  const lower = line.toLowerCase();
  if (lower.length < 6) return true;
  if (/^page\s+\d+/.test(lower)) return true;
  if (/opening balance|closing balance|brought forward|carried forward/.test(lower)) return true;
  if (/^statement\s+of\s+account/.test(lower)) return true;
  if (/^date\b.*\b(description|narration|particulars)\b/.test(lower)) return true;
  return false;
}

/**
 * Parse extracted statement text into rows. Lines that don't start with a
 * date are tolerated as continuation lines and appended to the previous row's
 * description (banks often wrap long narrations).
 */
export function parseStatement(rawText: string): ParsedRow[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const rows: ParsedRow[] = [];
  let balancePaise: number | null = null;
  let lastRow: ParsedRow | null = null;

  for (const line of lines) {
    if (isNoiseLine(line)) continue;
    const hasLeadingDate = DATE_PATTERNS.some(({ re }) => re.test(line));
    if (!hasLeadingDate) {
      if (lastRow && line.length < 100) {
        lastRow.description = cleanDescription(`${lastRow.description} ${line}`);
      }
      continue;
    }
    const { row, balancePaise: nextBal } = parseLine(line, balancePaise);
    balancePaise = nextBal;
    if (row) {
      rows.push(row);
      lastRow = row;
    } else {
      lastRow = null;
    }
  }
  return rows;
}
