// Fitbit — client-side OAuth 2.0 Authorization Code with PKCE.
// Fitbit allows public clients to exchange the code in the browser, so no
// backend is needed. The redirect URI must be registered exactly in the
// Fitbit app settings (https://dev.fitbit.com).

const AUTHORIZE_URL = "https://www.fitbit.com/oauth2/authorize";
const TOKEN_URL = "https://api.fitbit.com/oauth2/token";

export const FITBIT_SCOPES = ["activity", "heartrate", "sleep", "profile"].join(" ");

const STORAGE_KEY = "fitbit_pkce_state_v1";
const PKCE_TTL_MS = 10 * 60 * 1000;

interface PkceState {
  verifier: string;
  state: string;
  /** Where to return after the round-trip. */
  return_to: string;
  /** Epoch ms — used to expire abandoned flows. */
  created_at: number;
}

function readEnvClientId(): string {
  const clientId = import.meta.env.VITE_FITBIT_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "Missing VITE_FITBIT_CLIENT_ID. Register an app at https://dev.fitbit.com and add it to your .env."
    );
  }
  return clientId;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(byteLength: number): string {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

async function sha256(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return new Uint8Array(digest);
}

export function getFitbitRedirectUri(): string {
  // Use the integrations page as the redirect target; it handles the callback inline.
  return `${window.location.origin}/settings/integrations`;
}

/** Kick off the OAuth flow by redirecting the browser to Fitbit's consent screen. */
export async function startFitbitAuth(): Promise<void> {
  const clientId = readEnvClientId();
  const verifier = randomString(64);
  const challenge = base64UrlEncode(await sha256(verifier));
  const state = randomString(16);

  const pending: PkceState = {
    verifier,
    state,
    return_to: window.location.pathname + window.location.search,
    created_at: Date.now(),
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: FITBIT_SCOPES,
    redirect_uri: getFitbitRedirectUri(),
    state,
  });
  window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`);
}

export interface FitbitToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  user_id: string;
  [key: string]: unknown;
}

interface FitbitTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  user_id: string;
  errors?: { errorType: string; message: string }[];
}

/**
 * Detects an in-flight callback (`?code=…&state=…`) and exchanges the code for
 * tokens using the stored PKCE verifier. Returns null when no callback is in
 * progress. Clears query params on success/failure so refreshes are idempotent.
 */
export async function consumeFitbitCallback(): Promise<FitbitToken | null> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (!code && !error) return null;

  const raw = sessionStorage.getItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);

  // Strip OAuth params regardless of outcome.
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  window.history.replaceState({}, "", url.pathname + url.search);

  if (error) throw new Error(`Fitbit authorization denied: ${error}`);
  if (!raw) throw new Error("Missing PKCE state — the OAuth round-trip can't be verified.");
  const pending = JSON.parse(raw) as PkceState;
  if (state !== pending.state) throw new Error("OAuth state mismatch — possible CSRF, aborting.");
  if (Date.now() - pending.created_at > PKCE_TTL_MS) {
    throw new Error("Fitbit authorization expired. Please reconnect.");
  }

  const body = new URLSearchParams({
    client_id: readEnvClientId(),
    grant_type: "authorization_code",
    code: code!,
    code_verifier: pending.verifier,
    redirect_uri: getFitbitRedirectUri(),
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as FitbitTokenResponse;
  if (!res.ok || json.errors?.length) {
    const msg = json.errors?.[0]?.message || `Fitbit token exchange failed (${res.status}).`;
    throw new Error(msg);
  }
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
    scope: json.scope,
    user_id: json.user_id,
  };
}
