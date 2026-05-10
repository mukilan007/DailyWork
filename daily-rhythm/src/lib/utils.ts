type ClassValue = string | number | null | false | undefined | Record<string, boolean>;

/** Tiny classnames helper — concatenates truthy strings, supports object form. */
export function cn(...args: ClassValue[]): string {
  const out: string[] = [];
  for (const a of args) {
    if (!a) continue;
    if (typeof a === "string" || typeof a === "number") {
      out.push(String(a));
    } else if (typeof a === "object") {
      for (const [k, v] of Object.entries(a)) if (v) out.push(k);
    }
  }
  return out.join(" ");
}
