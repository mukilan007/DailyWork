import { Sun, Moon, Monitor, Palette, Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { useTheme, Theme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun; description: string; preview: string }[] = [
  {
    value: "light",
    label: "Light",
    icon: Sun,
    description: "Default bright theme",
    preview: "bg-white border-zinc-200",
  },
  {
    value: "dark",
    label: "Dark",
    icon: Moon,
    description: "Easier on the eyes at night",
    preview: "bg-zinc-900 border-zinc-700",
  },
  {
    value: "system",
    label: "System",
    icon: Monitor,
    description: "Follows your OS preference",
    preview: "bg-gradient-to-br from-white via-white to-zinc-900 border-zinc-300 dark:border-zinc-700",
  },
];

export function SettingsAppearancePage() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Appearance"
        icon={<Palette className="h-5 w-5" />}
        description="Customize how DailyWork looks on this device."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Palette className="h-4 w-4 text-primary" /> Theme
          </CardTitle>
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
                    "relative rounded-xl border-2 p-4 text-left transition-all active:scale-[0.98]",
                    active
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border hover:border-primary/40 hover:bg-accent/40"
                  )}
                  aria-pressed={active}
                >
                  {active && (
                    <span
                      className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                      aria-hidden
                    >
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  )}
                  <div className={cn("h-10 w-full rounded-md border mb-3", opt.preview)} aria-hidden />
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    <div className="font-medium text-sm">{opt.label}</div>
                  </div>
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
