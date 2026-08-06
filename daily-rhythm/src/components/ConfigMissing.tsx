/**
 * Shown when the Supabase env vars are absent, instead of a silent white
 * screen. A missing local `.env` is a setup problem, not a code bug — so we
 * explain exactly how to fix it.
 */
export function ConfigMissing() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0e0e12",
        color: "#e5e7eb",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: 20, marginBottom: 8, color: "#a78bfa" }}>
          DailyWork needs its Supabase keys
        </h1>
        <p style={{ color: "#9ca3af", fontSize: 14, lineHeight: 1.6 }}>
          The app can't find <code>VITE_SUPABASE_URL</code> and{" "}
          <code>VITE_SUPABASE_ANON_KEY</code>. Create a file named{" "}
          <code>.env</code> in the <code>daily-rhythm/</code> folder with:
        </p>
        <pre
          style={{
            background: "#17171d",
            border: "1px solid #2a2a33",
            borderRadius: 8,
            padding: 16,
            fontSize: 13,
            color: "#e5e7eb",
            marginTop: 12,
            whiteSpace: "pre-wrap",
          }}
        >
{`VITE_SUPABASE_URL=https://YOUR-PROJECT-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key`}
        </pre>
        <p style={{ color: "#9ca3af", fontSize: 13, lineHeight: 1.6, marginTop: 12 }}>
          Find both under <strong>Supabase Dashboard → Project Settings → API</strong>{" "}
          (Project URL and the <em>anon / public</em> key). Then{" "}
          <strong>restart the dev server</strong> (Vite only reads{" "}
          <code>.env</code> at startup).
        </p>
      </div>
    </div>
  );
}
