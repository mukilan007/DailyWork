import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Root error boundary. Without this, any render/module error unmounts the whole
 * React tree and leaves a silent white screen. Here we catch it, log the full
 * stack to the console, and render a readable panel with the message + stack so
 * failures are diagnosable in production too.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surfaced in the browser console with the component stack.
    console.error("[DailyWork] Uncaught render error:", error, info);
    this.setState({ info });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0e0e12",
          color: "#e5e7eb",
          padding: "2rem",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          overflow: "auto",
        }}
      >
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <h1 style={{ color: "#f87171", fontSize: 20, marginBottom: 8 }}>
            Something crashed while rendering
          </h1>
          <p style={{ color: "#9ca3af", marginBottom: 16, fontSize: 13 }}>
            The full error is also in your browser console. This screen replaces
            the old silent white page.
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "#17171d",
              border: "1px solid #2a2a33",
              borderRadius: 8,
              padding: 16,
              fontSize: 13,
              color: "#fca5a5",
            }}
          >
            {error.name}: {error.message}
          </pre>
          {(error.stack || info?.componentStack) && (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                background: "#17171d",
                border: "1px solid #2a2a33",
                borderRadius: 8,
                padding: 16,
                fontSize: 12,
                color: "#9ca3af",
                marginTop: 12,
              }}
            >
              {error.stack}
              {info?.componentStack}
            </pre>
          )}
          <button
            onClick={() => location.reload()}
            style={{
              marginTop: 16,
              background: "#7c3aed",
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
