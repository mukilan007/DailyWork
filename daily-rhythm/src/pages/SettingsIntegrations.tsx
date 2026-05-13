import { FormEvent, ReactNode, useEffect, useState } from "react";
import {
  Dumbbell,
  Activity,
  Heart,
  Watch,
  Plug,
  Info,
  CheckCircle2,
  Link2,
  Unlink,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Dialog } from "@/components/ui/Dialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { formatRelative } from "@/lib/dates";
import type { IntegrationProvider, UserIntegration } from "@/types";
import { cn } from "@/lib/utils";
import { connectGoogleFit } from "@/lib/integrations/google-fit";
import { startFitbitAuth, consumeFitbitCallback } from "@/lib/integrations/fitbit";

/** How a provider connects. */
type ConnectMethod = "api_key" | "oauth_google" | "oauth_pkce" | "manual";

interface IntegrationDef {
  id: IntegrationProvider;
  name: string;
  description: string;
  icon: ReactNode;
  /** Tailwind classes for the icon tile. */
  tone: string;
  method: ConnectMethod;
  /** External docs link shown in the connect dialog. */
  docsUrl?: string;
  /** Help text shown in the connect dialog. */
  helpText: string;
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "hevy",
    name: "Hevy",
    description: "Sync your strength workouts and exercises automatically.",
    icon: <Dumbbell className="h-5 w-5" />,
    tone: "bg-purple-500/10 text-purple-600 dark:text-purple-400 ring-purple-500/20",
    method: "api_key",
    docsUrl: "https://api.hevyapp.com/docs",
    helpText:
      "Generate a Personal API Key in your Hevy account settings, then paste it below. The key is stored in your private user_integrations row.",
  },
  {
    id: "google_fit",
    name: "Google Fit",
    description: "Pull in activity, steps, and heart rate from Google.",
    icon: <Activity className="h-5 w-5" />,
    tone: "bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-sky-500/20",
    method: "oauth_google",
    docsUrl: "https://developers.google.com/fit",
    helpText:
      "Click Connect to open Google's consent screen in a popup. Read-only access to activity, heart-rate, and body metrics is requested. The access token is stored on your private user_integrations row.",
  },
  {
    id: "fitbit",
    name: "Fitbit",
    description: "Sync sleep, heart rate, and daily activity.",
    icon: <Watch className="h-5 w-5" />,
    tone: "bg-teal-500/10 text-teal-600 dark:text-teal-400 ring-teal-500/20",
    method: "oauth_pkce",
    docsUrl: "https://dev.fitbit.com/build/reference/web-api/",
    helpText:
      "Click Connect to be redirected to Fitbit for authorization. We use OAuth 2.0 with PKCE so the exchange happens safely in your browser — no shared secrets. The redirect URI to register in your Fitbit app is shown below.",
  },
  {
    id: "apple_health",
    name: "Apple Health",
    description: "Import workouts and health metrics from iOS.",
    icon: <Heart className="h-5 w-5" />,
    tone: "bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/20",
    method: "manual",
    helpText:
      "Apple Health has no public web API — it lives inside iOS via HealthKit. Reserve the slot here, then export from the Health app on iPhone (Profile → Export All Health Data) and import the XML when that feature lands.",
  },
];

const PROVIDERS_BY_ID: Record<IntegrationProvider, IntegrationDef> = Object.fromEntries(
  INTEGRATIONS.map((i) => [i.id, i])
) as Record<IntegrationProvider, IntegrationDef>;

export function SettingsIntegrationsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<UserIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<IntegrationProvider | null>(null);
  const [busyProvider, setBusyProvider] = useState<IntegrationProvider | null>(null);
  /** Provider awaiting disconnect confirmation. */
  const [disconnectingProvider, setDisconnectingProvider] = useState<IntegrationProvider | null>(null);
  const [disconnectBusy, setDisconnectBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from("user_integrations").select("*");
      if (cancelled) return;
      if (error) setError(error.message);
      else setRows((data as UserIntegration[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Detect a Fitbit OAuth redirect-back and finalize the connection. The
  // library short-circuits when there's no callback in the URL, so the effect
  // is cheap to run on every mount.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await consumeFitbitCallback();
        if (cancelled || !token) return;
        setBusyProvider("fitbit");
        await handleConnect("fitbit", { credentials: token, status: "connected" });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusyProvider(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // handleConnect is intentionally not in deps — it's stable in this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const byProvider: Partial<Record<IntegrationProvider, UserIntegration>> = {};
  for (const r of rows) byProvider[r.provider] = r;

  const connectedCount = rows.filter((r) => r.status === "connected").length;

  async function handleConnect(
    provider: IntegrationProvider,
    payload: {
      credentials: Record<string, unknown>;
      status: "connected" | "pending";
      notes?: string | null;
    }
  ) {
    if (!user) return;
    const row: UserIntegration = {
      user_id: user.id,
      provider,
      status: payload.status,
      connected_at: new Date().toISOString(),
      last_sync_at: null,
      credentials: payload.credentials,
      notes: payload.notes ?? null,
    };
    // Optimistic upsert
    setRows((prev) => {
      const next = prev.filter((r) => r.provider !== provider);
      return [...next, row];
    });
    const { data, error } = await supabase
      .from("user_integrations")
      .upsert(
        {
          user_id: user.id,
          provider,
          status: payload.status,
          connected_at: row.connected_at,
          credentials: payload.credentials,
          notes: payload.notes ?? null,
        },
        { onConflict: "user_id,provider" }
      )
      .select()
      .single();
    if (error) {
      setError(error.message);
      // rollback
      setRows((prev) => prev.filter((r) => r.provider !== provider));
      return;
    }
    if (data) {
      setRows((prev) => [...prev.filter((r) => r.provider !== provider), data as UserIntegration]);
    }
    setConnectingProvider(null);
  }

  // Dispatched when the user clicks Connect on a card. API-key / manual flows
  // open the dialog; OAuth flows are kicked off directly.
  async function startConnect(provider: IntegrationProvider) {
    const def = PROVIDERS_BY_ID[provider];
    setError(null);
    if (def.method === "api_key" || def.method === "manual") {
      setConnectingProvider(provider);
      return;
    }
    setBusyProvider(provider);
    try {
      if (def.method === "oauth_google") {
        const token = await connectGoogleFit();
        await handleConnect(provider, { credentials: token, status: "connected" });
      } else {
        // oauth_pkce: navigates away on success; the callback effect finishes the flow.
        await startFitbitAuth();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      // Only clear busy if we didn't navigate away (PKCE redirect won't reach here).
      setBusyProvider(null);
    }
  }

  async function confirmDisconnect() {
    const provider = disconnectingProvider;
    if (!user || !provider) return;
    setDisconnectBusy(true);
    const prev = rows;
    setRows((rs) => rs.filter((r) => r.provider !== provider));
    const { error } = await supabase
      .from("user_integrations")
      .delete()
      .eq("provider", provider);
    setDisconnectBusy(false);
    if (error) {
      setError(error.message);
      setRows(prev);
      return;
    }
    setDisconnectingProvider(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        icon={<Plug className="h-5 w-5" />}
        description="Connect external services to sync your data."
        actions={
          !loading && (
            <Badge variant={connectedCount > 0 ? "success" : "secondary"}>
              {connectedCount} of {INTEGRATIONS.length} connected
            </Badge>
          )
        }
      />

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm flex items-start gap-2.5">
        <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <p className="text-amber-900 dark:text-amber-200">
          <strong>Heads up.</strong> Hevy connects with a personal API key, Google Fit and Fitbit
          use a sign-in popup, and Apple Health is iOS-only — reserve its slot here and import an
          XML export from your iPhone later.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <SkeletonList rows={4} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {INTEGRATIONS.map((it) => {
            const row = byProvider[it.id];
            return (
              <IntegrationCard
                key={it.id}
                def={it}
                row={row}
                busy={busyProvider === it.id}
                onConnectClick={() => startConnect(it.id)}
                onDisconnect={() => setDisconnectingProvider(it.id)}
              />
            );
          })}
        </div>
      )}

      <ConnectDialog
        provider={connectingProvider}
        onClose={() => setConnectingProvider(null)}
        onConnect={handleConnect}
      />

      <ConfirmDialog
        open={Boolean(disconnectingProvider)}
        title={
          disconnectingProvider
            ? `Disconnect ${PROVIDERS_BY_ID[disconnectingProvider].name}?`
            : "Disconnect"
        }
        description="Stored credentials will be removed from this account. You can reconnect any time."
        confirmLabel={disconnectBusy ? "Disconnecting…" : "Disconnect"}
        destructive
        busy={disconnectBusy}
        onConfirm={confirmDisconnect}
        onClose={() => setDisconnectingProvider(null)}
      />
    </div>
  );
}

function IntegrationCard({
  def,
  row,
  busy,
  onConnectClick,
  onDisconnect,
}: {
  def: IntegrationDef;
  row: UserIntegration | undefined;
  busy: boolean;
  onConnectClick: () => void;
  onDisconnect: () => void;
}) {
  const status = row?.status ?? "disconnected";

  return (
    <Card>
      <CardContent className="p-5 flex flex-col h-full">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "h-11 w-11 rounded-xl flex items-center justify-center ring-1 ring-inset shrink-0",
              def.tone
            )}
          >
            {def.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm">{def.name}</h3>
              <StatusBadge status={status} method={def.method} />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{def.description}</p>
          </div>
        </div>

        {/* Footer: connection metadata + actions. For disconnected cards we
            show a method hint (e.g. "Sign in with Google") rather than
            repeating "Not connected" — the badge in the header already
            communicates the status. */}
        <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between gap-2">
          <div className="text-[11px] text-muted-foreground min-w-0 truncate">
            {row && status === "connected" && (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                Connected {formatRelative(row.connected_at)}
              </span>
            )}
            {row && status === "pending" && <span>Awaiting setup</span>}
            {(!row || status === "disconnected") && (
              <span>{methodHint(def)}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {row && status !== "disconnected" ? (
              <Button variant="ghost" size="sm" onClick={onDisconnect} className="h-8">
                <Unlink className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            ) : def.method === "manual" ? (
              // Apple Health can't be connected from the web — make it
              // visually distinct so users don't expect an OAuth flow.
              <Button
                variant="outline"
                size="sm"
                onClick={onConnectClick}
                disabled={busy}
                className="h-8"
              >
                <Link2 className="h-3.5 w-3.5" />
                Reserve slot
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={onConnectClick}
                disabled={busy}
                className="h-8"
              >
                <Link2 className="h-3.5 w-3.5" />
                {busy ? "Connecting…" : "Connect"}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status, method }: { status: string; method: ConnectMethod }) {
  if (status === "connected") return <Badge variant="success">Connected</Badge>;
  if (status === "pending") return <Badge variant="warning">Pending</Badge>;
  if (method === "manual") return <Badge variant="secondary">iOS-only</Badge>;
  return <Badge variant="secondary">Not connected</Badge>;
}

/** Short, method-specific hint shown in disconnected card footers instead of
 *  repeating "Not connected" (which the status badge already says). Templating
 *  in `def.name` keeps the OAuth hints in sync if a provider is ever renamed. */
function methodHint(def: IntegrationDef): string {
  switch (def.method) {
    case "api_key":
      return "Connects with a personal API key";
    case "oauth_google":
    case "oauth_pkce":
      return `Sign in with ${def.name} to connect`;
    case "manual":
      return "iOS-only · import XML later";
  }
}

function ConnectDialog({
  provider,
  onClose,
  onConnect,
}: {
  provider: IntegrationProvider | null;
  onClose: () => void;
  onConnect: (
    p: IntegrationProvider,
    payload: { credentials: Record<string, unknown>; status: "connected" | "pending"; notes?: string | null }
  ) => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const def = provider ? PROVIDERS_BY_ID[provider] : null;

  useEffect(() => {
    if (!provider) {
      setApiKey("");
      setSaving(false);
    }
  }, [provider]);

  if (!def) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!def || !provider) return;
    setSaving(true);
    if (def.method === "api_key") {
      if (!apiKey.trim()) {
        setSaving(false);
        return;
      }
      await onConnect(provider, {
        credentials: { api_key: apiKey.trim() },
        status: "connected",
      });
    } else if (def.method === "manual") {
      await onConnect(provider, {
        credentials: {},
        status: "pending",
        notes: "Reserved — awaiting iOS Health Data XML import.",
      });
    }
    setSaving(false);
  }

  return (
    <Dialog
      open={Boolean(provider)}
      onClose={onClose}
      title={`Connect ${def.name}`}
      description={def.description}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-3">
          <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center ring-1 ring-inset shrink-0", def.tone)}>
            {def.icon}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{def.helpText}</p>
        </div>

        {def.method === "api_key" && (
          <div className="space-y-1.5">
            <Label htmlFor="api-key">Personal API key</Label>
            <Input
              id="api-key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="hevy_pk_..."
              autoComplete="off"
              autoFocus
              required
            />
            <p className="text-[11px] text-muted-foreground">
              Stored on your private row, locked by RLS. Never sent to anyone else.
            </p>
          </div>
        )}
        {def.method === "manual" && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
            We'll reserve this slot and mark it <strong>Pending</strong>. To bring data in, export
            your Health data on iPhone (Health app → profile photo → Export All Health Data) and
            import the resulting <code>export.xml</code> when that importer ships.
          </div>
        )}

        {def.docsUrl && (
          <a
            href={def.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Read the {def.name} API docs
          </a>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || (def.method === "api_key" && !apiKey.trim())}>
            {saving ? "Saving…" : def.method === "api_key" ? "Connect" : "Reserve slot"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

