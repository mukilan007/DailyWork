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
 *  need to fix a few rows in the review step.
 *
 *  We upscale small screenshots before handing them to Tesseract because the
 *  engine routinely loses small punctuation (decimal points, commas, the ₹
 *  glyph) on tight crops — e.g. a 30 px-tall row reading `₹ 42.00` OCRs as
 *  `34200`. Giving Tesseract ~2.5x the pixels per glyph is the simplest
 *  effective preprocessing step. */
async function extractImageText(
  file: File,
  onProgress?: StatementExtractProgress
): Promise<string> {
  const { recognize } = await import("tesseract.js");
  const source = await preprocessImageForOcr(file);
  const result = await recognize(source, "eng", {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress({ stage: "ocr", progress: m.progress });
      }
    },
  });
  return fixOcrCurrencyMisreads(result.data.text ?? "");
}

/** Scale + contrast-boost the source image so small text becomes legible to
 *  Tesseract. Tesseract wants ~300 DPI equivalents; tiny single-row screenshots
 *  (e.g. a 200 px crop showing `₹ 42.00`) lose the decimal dot and the ₹ glyph
 *  unless we upsample aggressively *and* push faint pixels toward pure black.
 *
 *  Strategy:
 *   - Target ~2400 px on the long edge for tiny inputs (< 800 px), ~1800 px
 *     otherwise; clamped between 1x and 6x so huge inputs stay sane.
 *   - After upscaling, convert to grayscale and apply a soft threshold around
 *     mid-luminance. This dramatically improves recognition of small
 *     punctuation against light grey UI backgrounds.
 *   - Falls back to returning the original File when the browser can't decode
 *     it (e.g. exotic formats), so OCR can still try. */
async function preprocessImageForOcr(file: File): Promise<Blob | File> {
  try {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("image decode failed"));
        el.src = url;
      });
      const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
      // Tiny crops need a lot more pixels per glyph — the decimal dot in
      // `42.00` is one or two source pixels wide, so a 6x upscale gives the
      // OCR engine ~12 px to work with.
      const targetLong = longEdge < 800 ? 2400 : 1800;
      const scale = Math.min(6, Math.max(1, targetLong / longEdge));
      const sw = Math.round(img.naturalWidth * scale);
      const sh = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, sw, sh);

      // Grayscale + soft threshold. Push dark pixels darker and light pixels
      // lighter so the decimal dot survives without aliasing into the
      // background. Range chosen empirically: < 110 → near-black,
      // > 180 → near-white, mid-band → linear stretch.
      try {
        const data = ctx.getImageData(0, 0, sw, sh);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
          const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          let v: number;
          if (lum < 110) v = lum * 0.5;
          else if (lum > 180) v = Math.min(255, 200 + (lum - 180) * 0.7);
          else v = (lum - 110) * (200 / 70) + 55; // stretch midtones
          v = Math.max(0, Math.min(255, v));
          px[i] = px[i + 1] = px[i + 2] = v;
        }
        ctx.putImageData(data, 0, 0);
      } catch {
        // getImageData can fail on tainted canvases — ignore and proceed
        // with the un-thresholded upscaled image.
      }

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png")
      );
      return blob ?? file;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return file;
  }
}

/** Tesseract reliably mis-OCRs the ₹ glyph as a leading digit (typically 2,
 *  3, or 7) attached to the amount with no separating space. The result is
 *  amounts inflated by an order of magnitude or more — `₹ 10,002.40` becomes
 *  `710,002.40`. We post-process the OCR text in two passes: first normalise
 *  "Rs"-like renderings of ₹ (including the digit+`s` misreads "2s"/"3s"/
 *  "7s") to a literal `₹ `, then strip a stray lead digit stuck to the
 *  amount — but only when the shape makes the strip unambiguous.
 *
 *  We previously also tried to strip a stray digit from no-comma amounts
 *  ("3305.00" → "305.00"), but the same shape is indistinguishable from a
 *  legit "799.00", causing a worse regression (₹799 → ₹99). For no-comma
 *  amounts we still leave the parser alone and rely on the user to fix the
 *  occasional off-by-one digit in the review table — these are visually
 *  obvious (₹3305 stands out from neighbouring ₹100s amounts).
 *
 *  Shapes we strip (Indian grouping is `D,DD,DDD.DD`; lakh segments = 2
 *  digits, only the final thousands segment has 3):
 *   - Case A: `DDD,DDD.DD` / `DDDD,DDD.DD`… (Western 3-3 grouping). Nearly
 *     always a misread `<₹><1-2 digit>,<3-digit thousand>.dd`. Trade-off:
 *     a genuinely Western-formatted OCR line (some bank apps do print
 *     `150,000.00`) loses its lead digit — accepted because Indian
 *     statements overwhelmingly use lakh grouping, and the review table
 *     shows the raw line for manual fix-up.
 *   - Case B: `DDD,DD,…,DDD.DD` — a 3-digit head followed by a 2-digit
 *     lakh segment. Valid in *no* grouping scheme, while the stripped
 *     remainder (`DD,DD,…,DDD.DD`) is proper Indian grouping, so the strip
 *     is unambiguous ("231,50,000.00" → "31,50,000.00").
 *
 *  Shapes we deliberately do NOT touch, even though they *could* carry a
 *  stray digit:
 *   - `DD,DDD.DD` ("31,234.56"): both the token and its stripped remainder
 *     ("1,234.56") are valid Indian amounts — ambiguous, so hands off.
 *   - `DD,DD,DDD.DD` ("71,23,456.78"): same story at lakh scale.
 *   - Anything directly preceded by a correctly-OCR'd ₹: if the glyph
 *     rendered, the lead digit is part of the amount. We also considered
 *     using a correctly-OCR'd ₹ *elsewhere on the line* as a signal to
 *     strip the ambiguous shapes above, but rejected it: one glyph
 *     rendering doesn't imply the neighbouring one failed, and the false-
 *     positive cost (corrupting a legit ₹31,234.56) outweighs the win. */
function fixOcrCurrencyMisreads(text: string): string {
  // Pass 1 — currency-marker normalisation. OCR sometimes renders ₹ as an
  // "Rs"-like token: literal "Rs"/"rs" (₹ *is* the rupee sign), or a digit
  // plus "s" ("2s"/"3s"/"7s" — the stem reads as a digit, the hook as s).
  // Left alone these don't corrupt the parsed value (the "s" separates the
  // stray digit from the amount), but pass 2 would then see a bare
  // Western-grouped amount ("2s150,000.00" → "150,000.00") and strip its
  // *real* lead digit. Normalising to "₹ " both cleans the text and arms
  // pass 2's ₹ lookbehind guard. Conservative on purpose:
  //  - digit+s is restricted to 2/3/7 (the digits Tesseract confuses ₹
  //    with) so narration tokens like "6s" are never rewritten;
  //  - `(?<![A-Za-z0-9₹])` keeps word endings ("Stores 99.00") intact;
  //  - only fires when a well-formed `xx.xx` amount follows immediately.
  let out = text.replace(
    /(?<![A-Za-z0-9₹])(?:[Rr][sS]\.?|[237][sS])\s?(?=(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2})/g,
    "₹ "
  );

  // Pass 2 — strip the stray lead digit. Shared guards on both cases:
  //  - `(?<!₹\s?)`: the ₹ rendered correctly, so the digit is real;
  //  - `(?<![\d.,])`: don't start mid-number;
  //  - `(?=[1-9])`: if stripping would leave an amount starting with 0
  //    (e.g. "100,000.00" → "00,000.00"), it can't have been a misread ₹ —
  //    no real amount starts with 0 — so leave it alone. Without this, a
  //    legit ₹1,00,000.00 parses to zero and the row is silently dropped
  //    before review.
  // Case A: remainder is Western 3-3 grouping.
  out = out.replace(
    /(?<!₹\s?)(?<![\d.,])(\d)(?=[1-9])(\d{2,3},\d{3}(?:,\d{3})*\.\d{2})(?!\d)/g,
    "$2"
  );
  // Case B: remainder is Indian grouping with a 2-digit head + 2-digit lakh
  // segments; the unstripped token (3-digit head before a 2-digit segment)
  // is invalid in every scheme. A 1-digit remainder head is NOT stripped —
  // "71,23,456.78" is itself a valid Indian amount (see comment above).
  out = out.replace(
    /(?<!₹\s?)(?<![\d.,])(\d)(?=[1-9])(\d{2}(?:,\d{2})+,\d{3}\.\d{2})(?!\d)/g,
    "$2"
  );
  return out;
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
  if (month < 1 || month > 12 || day < 1) return null;
  // Real calendar check — "31/02" from an OCR misread must not produce
  // "2026-02-31", which Postgres rejects and which fails the whole insert
  // chunk at import time.
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day > daysInMonth) return null;
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

/** Look at the few characters preceding an amount in the line to detect an
 *  explicit `+` (income) or `−`/`-` (expense) sign. Scans up to 6 chars
 *  back of the amount — the first `+`/`-` wins. We deliberately tolerate
 *  whatever OCR put between the sign and the amount (`₹`, common substitute
 *  glyphs like `%`/`¥`/`F`, stray misread digits, whitespace) rather than
 *  enumerating each, so that `+ ₹ 305.00` resolves to income even when ₹
 *  was rendered as `%`, `3` (attached), or dropped entirely.
 *
 *  Only treats the sign as *signaled* when it's the first "real" token
 *  preceding the amount AND it sits at the start of the line or is preceded
 *  by whitespace. This avoids classifying purchases like
 *  `UPI-Aditya Birla Order#+25 ₹799` as income just because a `+` appears
 *  earlier on the line. */
function detectAmountSign(line: string, amountStart: number): "+" | "-" | null {
  const start = Math.max(0, amountStart - 6);
  // Characters we consider "between" the sign and the amount (skipped over).
  const isFiller = (ch: string) =>
    ch === " " ||
    ch === "\t" ||
    ch === "₹" ||
    ch === "%" ||
    ch === "¥" ||
    ch === "F" ||
    (ch >= "0" && ch <= "9") ||
    ch === ".";
  for (let i = amountStart - 1; i >= start; i--) {
    const ch = line[i];
    if (ch === "+" || ch === "-" || ch === "\u2212") {
      // Require the sign to be isolated: start of line, or preceded by
      // whitespace. Otherwise it's likely part of a token (e.g. "Order#+25").
      const prev = i > 0 ? line[i - 1] : "";
      if (prev === "" || prev === " " || prev === "\t") {
        return ch === "+" ? "+" : "-";
      }
      return null;
    }
    if (!isFiller(ch)) {
      // Hit a non-filler char before any sign — no signed marker.
      return null;
    }
  }
  return null;
}

/**
 * Parse one date-prefixed line into a `ParsedRow`. Returns `null` if the line
 * doesn't look like a real transaction (e.g. opening balance, page number,
 * header that happens to start with a date-like number).
 *
 * Strategy:
 *  1. Identify the date at the start of the line.
 *  2. Find every `xx.xx` amount on the line.
 *  3. When the document has a running-balance column, the last amount is the
 *     balance (and dropped). Otherwise every amount is treated as a
 *     transaction amount.
 *  4. The remaining amount(s) become the transaction amount:
 *     - If a `Dr`/`Cr` marker is attached to the amount, use it.
 *     - Else if a `+` / `−` sign immediately precedes the amount, use it.
 *     - Else if two amounts remain (separate debit + credit columns), the
 *       non-zero one wins.
 *     - Otherwise fall back to a balance-delta sanity check.
 *  5. Description = everything between the date and the first amount,
 *     trimmed of noise (UTR/ref strings get truncated for display).
 */
function parseLine(
  line: string,
  prevBalancePaise: number | null,
  hasBalanceColumn: boolean
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

  // Collect all amount matches with their positions. `signaled` captures the
  // amount's kind when the line makes it explicit — either via a `Dr`/`Cr`
  // accounting marker, an explicit `+`/`−` sign, or a leading minus in the
  // amount text itself.
  const amounts: Array<{
    start: number;
    end: number;
    text: string;
    signaled?: "income" | "expense";
  }> = [];
  AMOUNT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_RE.exec(line))) {
    // Look for an immediately-following Dr/Cr marker (allow a space).
    const tail = line.slice(m.index + m[0].length, m.index + m[0].length + 4).toLowerCase();
    let signaled: "income" | "expense" | undefined;
    if (/^\s*cr\b/.test(tail)) signaled = "income";
    else if (/^\s*dr\b/.test(tail)) signaled = "expense";
    else {
      const sign = detectAmountSign(line, m.index);
      if (sign === "+") signaled = "income";
      else if (sign === "-") signaled = "expense";
    }
    amounts.push({
      start: m.index,
      end: m.index + m[0].length,
      text: m[0],
      signaled,
    });
  }

  if (amounts.length === 0) return { row: null, balancePaise: prevBalancePaise };

  // Whether the *last* amount on this line is a running balance depends on
  // the document. Statements with a Balance column drop the last one;
  // screenshot-style "Date | Description | Amount" tables don't.
  const balance = hasBalanceColumn ? amounts[amounts.length - 1] : null;
  const balancePaise = balance ? amountToPaise(balance.text) : prevBalancePaise;
  const txAmounts = hasBalanceColumn ? amounts.slice(0, -1) : amounts;
  if (txAmounts.length === 0) {
    // Likely an opening-balance / closing-balance row — skip but track balance.
    return { row: null, balancePaise };
  }

  // Pick the transaction amount + kind.
  let kind: "income" | "expense" = "expense";
  let amountPaise = 0;
  const signaled = txAmounts.find((a) => a.signaled);

  if (signaled) {
    amountPaise = Math.abs(amountToPaise(signaled.text));
    kind = signaled.signaled!;
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
    } else if (prevBalancePaise !== null && balancePaise !== null) {
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
    } else if (prevBalancePaise !== null && balancePaise !== null) {
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

  // Decide once per document whether to expect a running-balance column.
  // PDFs from HDFC/ICICI/SBI/etc. typically carry one (most date-led lines
  // have ≥2 amounts: tx amount + balance). Screenshot-style mobile/app
  // statements usually show just the transaction amount. We pick the policy
  // that matches the majority of date-led lines.
  const hasBalanceColumn = detectBalanceColumn(lines);

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
    const { row, balancePaise: nextBal } = parseLine(
      line,
      balancePaise,
      hasBalanceColumn
    );
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

// ---------------------------------------------------------------------------
// Diagnostics — explains *why* a parse returned 0 rows.
// ---------------------------------------------------------------------------

export interface StatementDiagnostics {
  /** Non-blank lines in the input. */
  totalLines: number;
  /** Lines dropped by `isNoiseLine` (page numbers, headers, balances). */
  noiseLines: number;
  /** Lines that start with a recognised date token. */
  dateLedLines: number;
  /** Lines containing at least one `xx.xx` numeric amount. */
  amountLines: number;
  /** First few date-led lines (for display, max 3). */
  sampleDateLed: string[];
  /** First few non-date, non-noise lines (for display, max 3). */
  sampleNoDate: string[];
}

/** Inspect raw extracted text to explain why parsing produced no rows. The
 *  caller (the import dialog) uses these counts to build a specific error
 *  message instead of the generic "layout not supported" copy. */
export function diagnoseStatement(rawText: string): StatementDiagnostics {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let noiseLines = 0;
  let dateLedLines = 0;
  let amountLines = 0;
  const sampleDateLed: string[] = [];
  const sampleNoDate: string[] = [];

  for (const line of lines) {
    if (isNoiseLine(line)) {
      noiseLines++;
      continue;
    }
    const hasDate = DATE_PATTERNS.some(({ re }) => re.test(line));
    AMOUNT_RE.lastIndex = 0;
    const hasAmount = AMOUNT_RE.test(line);
    if (hasDate) {
      dateLedLines++;
      if (sampleDateLed.length < 3) sampleDateLed.push(line);
    } else if (sampleNoDate.length < 3) {
      sampleNoDate.push(line);
    }
    if (hasAmount) amountLines++;
  }

  return {
    totalLines: lines.length,
    noiseLines,
    dateLedLines,
    amountLines,
    sampleDateLed,
    sampleNoDate,
  };
}

/** Count amounts on each date-led line; if a majority have 2+ amounts we
 *  assume a Balance column. Otherwise we treat every amount as a transaction
 *  amount (the screenshot / app-statement layout). */
function detectBalanceColumn(lines: string[]): boolean {
  let total = 0;
  let multi = 0;
  for (const line of lines) {
    if (isNoiseLine(line)) continue;
    if (!DATE_PATTERNS.some(({ re }) => re.test(line))) continue;
    total++;
    AMOUNT_RE.lastIndex = 0;
    let count = 0;
    while (AMOUNT_RE.exec(line)) count++;
    if (count >= 2) multi++;
  }
  // Empty / single-line cases: default to "yes balance column" so PDF
  // statements (the common case) keep behaving as before.
  if (total < 3) return true;
  return multi / total > 0.5;
}
