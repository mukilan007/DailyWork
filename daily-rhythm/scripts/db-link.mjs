// Cross-platform `supabase link`. npm scripts can't expand env vars portably
// (`%VAR%` on Windows vs `$VAR` on POSIX), so this thin wrapper reads .env and
// shells out itself.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (!process.env.SUPABASE_PROJECT_ID) {
  try {
    for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
      }
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}

const ref = process.env.SUPABASE_PROJECT_ID;
if (!ref) {
  console.error(
    "SUPABASE_PROJECT_ID is not set. Add it to .env (see .env.example) " +
      "or export it in your shell."
  );
  process.exit(1);
}

const result = spawnSync("supabase", ["link", "--project-ref", ref], {
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
