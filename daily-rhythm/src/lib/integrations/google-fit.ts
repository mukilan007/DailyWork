// Google Fit — client-side OAuth via Google Identity Services (GIS).
// Uses the popup-based Token Client, so no redirect URI is required (the OAuth
// client just needs the app origin in "Authorized JavaScript origins").

const GIS_SRC = "https://accounts.google.com/gsi/client";

// Read-only scopes that cover steps, heart-rate, activity, and body metrics.
export const GOOGLE_FIT_SCOPES = [
  "https://www.googleapis.com/auth/fitness.activity.read",
  "https://www.googleapis.com/auth/fitness.heart_rate.read",
  "https://www.googleapis.com/auth/fitness.body.read",
].join(" ");

interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

interface GoogleAccountsOauth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    prompt?: string;
    callback: (resp: TokenResponse) => void;
    error_callback?: (err: { type: string; message?: string }) => void;
  }) => TokenClient;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleAccountsOauth2 } };
  }
}

let gisLoader: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoader) return gisLoader;
  gisLoader = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoader = null;
      s.remove();
      reject(new Error("Failed to load Google Identity Services script."));
    };
    document.head.appendChild(s);
  });
  return gisLoader;
}

export interface GoogleFitToken {
  access_token: string;
  /** Absolute epoch ms when the token expires. */
  expires_at: number;
  scope: string;
  [key: string]: unknown;
}

/** Opens a Google consent popup and resolves with the access token. */
export async function connectGoogleFit(): Promise<GoogleFitToken> {
  const clientId = import.meta.env.VITE_GOOGLE_FIT_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "Missing VITE_GOOGLE_FIT_CLIENT_ID. Create an OAuth Client (Web) in Google Cloud and add it to your .env."
    );
  }
  await loadGis();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error("Google Identity Services unavailable.");

  return new Promise<GoogleFitToken>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_FIT_SCOPES,
      prompt: "consent",
      callback: (resp) => {
        if (resp.error) {
          reject(new Error(resp.error_description || resp.error));
          return;
        }
        resolve({
          access_token: resp.access_token,
          expires_at: Date.now() + resp.expires_in * 1000,
          scope: resp.scope,
        });
      },
      error_callback: (err) => reject(new Error(err.message || err.type || "Google sign-in cancelled.")),
    });
    client.requestAccessToken();
  });
}
