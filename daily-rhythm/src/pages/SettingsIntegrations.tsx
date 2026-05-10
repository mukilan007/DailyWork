import { ReactNode } from "react";
import { Dumbbell, Activity, Heart, Watch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

interface IntegrationDef {
  id: string;
  name: string;
  description: string;
  icon: ReactNode;
}

// UI-only: connecting these requires backend OAuth — wired in a later phase.
const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "hevy",
    name: "Hevy",
    description: "Sync your strength workouts and exercises automatically.",
    icon: <Dumbbell className="h-5 w-5" />,
  },
  {
    id: "google-fit",
    name: "Google Fit",
    description: "Pull in activity, steps, and heart rate from Google.",
    icon: <Activity className="h-5 w-5" />,
  },
  {
    id: "fitbit",
    name: "Fitbit",
    description: "Sync sleep, heart rate, and daily activity.",
    icon: <Watch className="h-5 w-5" />,
  },
  {
    id: "apple-health",
    name: "Apple Health",
    description: "Import workouts and health metrics from iOS.",
    icon: <Heart className="h-5 w-5" />,
  },
];

export function SettingsIntegrationsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-muted-foreground">Connect external services to sync your data.</p>
      </header>

      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
        <p>
          <strong>Coming soon.</strong> OAuth connections require backend support. The UI is in place
          — flipping the switch will work once the integration is wired up.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {INTEGRATIONS.map((it) => (
          <Card key={it.id}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-accent flex items-center justify-center text-accent-foreground">
                  {it.icon}
                </div>
                <div>
                  <CardTitle className="text-base">{it.name}</CardTitle>
                  <CardDescription>Not connected</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">{it.description}</p>
              <Button variant="outline" size="sm" disabled>
                Connect
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
