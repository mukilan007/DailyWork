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
import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { formatRelative } from "@/lib/dates";
import type { IntegrationProvider, UserIntegration } from "@/types";
import { cn } from "@/lib/utils";

/** How a provider connects: paste a personal API key, or OAuth (server-side, not yet wired). */
type ConnectMethod = "api_key" | "oauth_pending";

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
    method: "oauth_pending",
    docsUrl: "https://developers.google.com/fit",
    helpText:
      "Google Fit requires an OAuth 2.0 flow with a server-side token exchange. Once a backend function is configured, this will open Google's consent screen.",
  },
  {
    id: "fitbit",
    name: "Fitbit",
    description: "Sync sleep, heart rate, and daily activity.",
    icon: <Watch className="h-5 w-5" />,
    tone: "bg-teal-500/10 text-teal-600 dark:text-teal-400 ring-teal-500/20",
    method: "oauth_pending",
    docsUrl: "https://dev.fitbit.com/build/reference/web-api/",
    helpText:
      "Fitbit uses OAuth 2.0 with PKCE. A server function is needed to exchange the authorization code for tokens — coming soon.",
  },
  {
    id: "apple_health",
    name: "Apple Health",
    description: "Import workouts and health metrics from iOS.",
    icon: <Heart className="h-5 w-5" />,
    tone: "bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/20",
    method: "oauth_pending",
    helpText:
      "Apple Health is iOS-only. Connecting requires a companion iOS app (HealthKit) — there is no public web API. We'll keep your slot reserved.",
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

  const byProvider: Partial<Record<IntegrationProvider, UserIntegration>> = {};
  for (const r of rows) byProvider[r.provider] = r;

  const connectedCount = rows.filter((r) => r.status === "connected").length;

  async function handleConnect(
    provider: IntegrationProvider,
    payload: { credentials: Record<string, unknown>; status: "connected" | "pending"; notes?: string | null }
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

  async function handleDisconnect(provider: IntegrationProvider) {
    if (!user) return;
    if (!confirm(`Disconnect ${PROVIDERS_BY_ID[provider].name}? Stored credentials will be removed.`))
      return;
    const prev = rows;
    setRows((rs) => rs.filter((r) => r.provider !== provider));
    const { error } = await supabase
      .from("user_integrations")
      .delete()
      .eq("provider", provider);
    if (error) {
      setError(error.message);
      setRows(prev);
    }
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
          <strong>Heads up.</strong> Hevy supports a Personal API key — you can connect now. The other
          providers need a server-side OAuth function; their slots are reserved and will activate once
          configured.
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
                onConnectClick={() => setConnectingProvider(it.id)}
                onDisconnect={() => handleDisconnect(it.id)}
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
    </div>
  );
}

function IntegrationCard({
  def,
  row,
  onConnectClick,
  onDisconnect,
}: {
  def: IntegrationDef;
  row: UserIntegration | undefined;
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

        {/* Footer: connection metadata + actions */}
        <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between gap-2">
          <div className="text-[11px] text-muted-foreground min-w-0 truncate">
            {row ? (
              <>
                {status === "connected" && (
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                    Connected {formatRelative(row.connected_at)}
                  </span>
                )}
                {status === "pending" && <span>Awaiting OAuth setup</span>}
                {status === "disconnected" && <span>Disconnected</span>}
              </>
            ) : (
              <span>Not connected</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {row && status !== "disconnected" ? (
              <Button variant="ghost" size="sm" onClick={onDisconnect} className="h-8">
                <Unlink className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={onConnectClick}
                disabled={def.method === "oauth_pending"}
                title={def.method === "oauth_pending" ? "Awaiting backend OAuth setup" : undefined}
                className="h-8"
              >
                <Link2 className="h-3.5 w-3.5" />
                Connect
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
  if (method === "oauth_pending") return <Badge variant="warning">Coming soon</Badge>;
  return <Badge variant="secondary">Not connected</Badge>;
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
    } else {
      await onConnect(provider, {
        credentials: {},
        status: "pending",
        notes: "OAuth flow not yet configured. Slot reserved.",
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

        {def.method === "api_key" ? (
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
        ) : (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
            We'll reserve this slot in your account and mark it <strong>Pending</strong>. The actual
            OAuth flow will activate once a backend function is wired — no action needed on your side.
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
            {saving ? "Connecting…" : def.method === "api_key" ? "Connect" : "Reserve slot"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

