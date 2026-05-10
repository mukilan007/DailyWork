import { NavLink, useLocation } from "react-router-dom";
import {
  Home,
  Dumbbell,
  Activity,
  HeartPulse,
  Settings as SettingsIcon,
  Droplet,
  CalendarHeart,
  Palette,
  User,
  Plug,
  LogOut,
  ChevronDown,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
}

interface NavGroup {
  label: string;
  icon: typeof Home;
  children: NavItem[];
}

const PRIMARY: NavItem[] = [
  { to: "/", label: "Home", icon: Home },
  { to: "/daily-routine", label: "Daily Routine", icon: Activity },
  { to: "/gym", label: "Gym Workout", icon: Dumbbell },
];

const HEALTH: NavGroup = {
  label: "Health Tracker",
  icon: HeartPulse,
  children: [
    { to: "/health/period", label: "Period Tracker", icon: CalendarHeart },
    { to: "/health/diabetes", label: "Diabetes", icon: Droplet },
  ],
};

const SETTINGS: NavGroup = {
  label: "Settings",
  icon: SettingsIcon,
  children: [
    { to: "/settings/profile", label: "Profile", icon: User },
    { to: "/settings/appearance", label: "Appearance", icon: Palette },
    { to: "/settings/integrations", label: "Integrations", icon: Plug },
  ],
};

export function Sidebar() {
  const { user, signOut } = useAuth();
  const location = useLocation();

  const isInGroup = (g: NavGroup) =>
    g.children.some((c) => location.pathname.startsWith(c.to));

  const [healthOpen, setHealthOpen] = useState(() => isInGroup(HEALTH));
  const [settingsOpen, setSettingsOpen] = useState(() => isInGroup(SETTINGS));

  return (
    <aside className="hidden md:flex md:w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
            <Activity className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-foreground">DailyWork</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {PRIMARY.map((item) => (
          <NavItemLink key={item.to} {...item} />
        ))}

        <NavGroupSection
          group={HEALTH}
          open={healthOpen}
          onToggle={() => setHealthOpen((o) => !o)}
        />

        <NavGroupSection
          group={SETTINGS}
          open={settingsOpen}
          onToggle={() => setSettingsOpen((o) => !o)}
        />
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">
              {user?.email ?? ""}
            </p>
          </div>
          <button
            onClick={signOut}
            className="p-2 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function NavItemLink({ to, label, icon: Icon }: NavItem) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
        )
      }
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </NavLink>
  );
}

function NavGroupSection({
  group,
  open,
  onToggle,
}: {
  group: NavGroup;
  open: boolean;
  onToggle: () => void;
}) {
  const Icon = group.icon;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground transition-colors"
        aria-expanded={open}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown
          className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="pl-6 mt-1 space-y-1">
          {group.children.map((child) => (
            <NavItemLink key={child.to} {...child} />
          ))}
        </div>
      )}
    </div>
  );
}
