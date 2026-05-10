// Scans supabase/migrations/*.sql for statements that risk data loss.
// Each dangerous op must be opted into with a `-- pragma: allow-<rule>` line
// in the same file, otherwise the run exits 1.
//
// Run from the todo-app/ directory:
//   node scripts/migration-lint.mjs
//
// Pragmas (place at top of the migration):
//   -- pragma: allow-drop-column reason="superseded by is_archived (2026-04-01)"
//   -- pragma: allow-destructive   <-- blanket; allows everything in this file

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";

// Whole-file regex rules.
const RULES = [
  { id: "drop-table",   pattern: /\bdrop\s+table\b/i,                            why: "DROP TABLE destroys all rows." },
  { id: "drop-column",  pattern: /\bdrop\s+column\b/i,                           why: "DROP COLUMN destroys data in that column." },
  { id: "drop-schema",  pattern: /\bdrop\s+schema\b/i,                           why: "DROP SCHEMA cascades to all objects." },
  { id: "truncate",     pattern: /\btruncate\b/i,                                why: "TRUNCATE wipes all rows." },
  { id: "alter-type",   pattern: /\balter\s+(?:column|table)[\s\S]*?\btype\b/i,  why: "ALTER ... TYPE may rewrite the table; bad casts lose data." },
  { id: "set-not-null", pattern: /\bset\s+not\s+null\b/i,                        why: "SET NOT NULL fails if existing NULLs aren't backfilled first." },
  { id: "rename",       pattern: /\balter\s+(?:table|view|materialized\s+view)\s+\S+[\s\S]*?\brename\b/i, why: "RENAME on tables/columns breaks running clients reading the old name." },
];

// Per-statement rules (run after splitting on `;`).
const STMT_RULES = [
  {
    id: "delete-no-where",
    why: "DELETE without WHERE wipes the entire table.",
    match: (s) => /\bdelete\s+from\b/i.test(s) && !/\bwhere\b/i.test(s),
  },
  {
    id: "update-no-where",
    why: "UPDATE without WHERE rewrites every row.",
    match: (s) => /\bupdate\s+\S+\s+set\b/i.test(s) && !/\bwhere\b/i.test(s),
  },
];

function stripComments(sql) {
  // Strip /* ... */ and -- comments, but preserve `-- pragma:` lines
  // so allow-list parsing still sees them.
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => (/^\s*--\s*pragma:/i.test(line) ? line : line.replace(/--.*$/, "")))
    .join("\n");
}

function statements(sql) {
  // Naive split — fine for lint; pathological strings just get extra warnings.
  return sql.split(";").map((s) => s.trim()).filter(Boolean);
}

function pragmasIn(raw) {
  // Map<id, reason|null>. A pragma without `reason="..."` stores null and the
  // lint reports it as an error if the pragma actually downgrades a rule.
  const map = new Map();
  const re = /--\s*pragma:\s*allow-([\w-]+)(?:[^\n]*?reason\s*=\s*"([^"]+)")?/gi;
  for (const m of raw.matchAll(re)) {
    map.set(m[1].toLowerCase(), m[2] ?? null);
  }
  return map;
}

function scan(file, raw) {
  const allowed = pragmasIn(raw);
  const blanket = allowed.has("destructive");
  const sql = stripComments(raw);
  const issues = [];

  const flag = (id, why) => {
    const downgraded = blanket || allowed.has(id);
    if (!downgraded) {
      issues.push({ rule: id, why, kind: "error" });
      return;
    }
    const reason = allowed.has(id) ? allowed.get(id) : allowed.get("destructive");
    if (!reason) {
      issues.push({
        rule: id,
        why: `${why} pragma allow-${id} requires reason="..."`,
        kind: "error",
      });
    } else {
      issues.push({ rule: id, why: `${why} (allowed: ${reason})`, kind: "warn" });
    }
  };

  for (const r of RULES) {
    if (r.pattern.test(sql)) flag(r.id, r.why);
  }
  for (const stmt of statements(sql)) {
    for (const r of STMT_RULES) {
      if (r.match(stmt)) flag(r.id, r.why);
    }
  }
  return issues;
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
let errors = 0;
let warnings = 0;

for (const f of files) {
  const raw = readFileSync(join(DIR, f), "utf8");
  for (const issue of scan(f, raw)) {
    const tag = issue.kind === "error" ? "ERROR" : "warn ";
    console.error(`[${tag}] ${f}: ${issue.rule} — ${issue.why}`);
    if (issue.kind === "error") errors++;
    else warnings++;
  }
}

if (errors > 0) {
  console.error(
    `\n${errors} blocking issue(s). To proceed, add a pragma comment to the migration, e.g.:`
  );
  console.error(
    `  -- pragma: allow-drop-column reason="superseded by is_archived on 2026-04-01"`
  );
  process.exit(1);
}
if (warnings > 0) {
  console.error(
    `\n${warnings} acknowledged destructive op(s). Backup will run before apply.`
  );
}
console.log(`Lint OK — scanned ${files.length} migration file(s).`);
