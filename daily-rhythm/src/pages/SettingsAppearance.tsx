import { Sun, Moon, Monitor } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { useTheme, Theme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun; description: string }[] = [
  { value: "light", label: "Light", icon: Sun, description: "Default bright theme" },
  { value: "dark", label: "Dark", icon: Moon, description: "Easier on the eyes at night" },
  { value: "system", label: "System", icon: Monitor, description: "Follows your OS preference" },
];

export function SettingsAppearancePage() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Appearance</h1>
        <p className="text-muted-foreground">Customize how DailyWork looks on this device.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>Choose between light, dark, or follow your operating system.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = theme === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTheme(opt.value)}
                  className={cn(
                    "rounded-lg border p-4 text-left transition-colors",
                    active
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border hover:border-primary/50 hover:bg-accent/50"
                  )}
                  aria-pressed={active}
                >
                  <Icon className="h-5 w-5 mb-2" />
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">{opt.description}</div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
