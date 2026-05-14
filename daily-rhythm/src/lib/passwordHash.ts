/**
 * Client-side password derivation.
 *
 * The browser hashes the user's plaintext password (with email as salt) using
 * PBKDF2-SHA256 before it ever leaves the page. The string Supabase sees on
 * the wire — and stores after its own bcrypt round — is the hex digest, not
 * the original password.
 *
 * Why:
 *  - The plaintext password no longer appears in DevTools → Network → Payload.
 *  - If Supabase's DB is ever dumped and bcrypt cracked, an attacker recovers
 *    the digest, not the user's actual password. So password reuse on other
 *    sites is protected.
 *
 * Constraints:
 *  - The KDF params (algorithm, iterations, salt scheme) are FIXED FOREVER.
 *    Changing any of them invalidates every existing user's password. If we
 *    ever need to migrate, do it lazily on next sign-in.
 *  - Email is normalised (lowercased + trimmed) so case differences in the
 *    email field can't desync the derivation between signup and signin.
 *  - This is *additional* defense; TLS still handles in-transit confidentiality
 *    and Supabase bcrypts on the server side regardless.
 */

const SALT_PREFIX = "daily-rhythm:v1:";
const ITERATIONS = 100_000;
const KEY_LENGTH_BITS = 256;

/** Derive a 64-char hex password digest from (email, password). */
export async function derivePassword(email: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const normalisedEmail = email.trim().toLowerCase();

  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(`${SALT_PREFIX}${normalisedEmail}`),
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    KEY_LENGTH_BITS,
  );

  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Password-strength policy for new passwords (signup + change-password).
 *
 * Sign-in must NOT call this — legacy accounts may have shorter passwords
 * predating the policy, and rejecting them at sign-in would lock those users
 * out before the legacy migration path in Auth.tsx / SettingsProfile.tsx can
 * rotate them.
 */
export type PasswordIssue = "length" | "letter" | "number" | "special";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_HINT = "At least 8 characters with a letter, a number, and a special character.";

export function validatePasswordStrength(password: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) issues.push("length");
  if (!/[A-Za-z]/.test(password)) issues.push("letter");
  if (!/[0-9]/.test(password)) issues.push("number");
  if (!/[^A-Za-z0-9]/.test(password)) issues.push("special");
  return issues;
}

const ISSUE_LABEL: Record<PasswordIssue, string> = {
  length: `at least ${PASSWORD_MIN_LENGTH} characters`,
  letter: "a letter",
  number: "a number",
  special: "a special character",
};

/** Build a human-readable message from validator output. Returns "" when valid. */
export function describePasswordIssues(issues: PasswordIssue[]): string {
  if (issues.length === 0) return "";
  const parts = issues.map((i) => ISSUE_LABEL[i]);
  if (parts.length === 1) return `Password must include ${parts[0]}.`;
  if (parts.length === 2) return `Password must include ${parts[0]} and ${parts[1]}.`;
  return `Password must include ${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}.`;
}
