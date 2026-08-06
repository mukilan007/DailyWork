import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ConfigMissing } from "@/components/ConfigMissing";
import { isSupabaseConfigured } from "@/lib/supabase";
import { registerServiceWorker } from "@/lib/notifications";
import "./index.css";

// PWA: no-op in dev, registers /sw.js in production builds. Guarded so a
// failure here can never take down app startup.
try {
  registerServiceWorker();
} catch (e) {
  console.error("[DailyWork] service worker registration failed:", e);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      {isSupabaseConfigured ? <App /> : <ConfigMissing />}
    </ErrorBoundary>
  </StrictMode>
);
