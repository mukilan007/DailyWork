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
  ListTodo,
  LogOut,
  ChevronDown,
  X,
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
  { to: "/todos", label: "Todos", icon: ListTodo },
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

interface SidebarProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({ mobileOpen, onCloseMobile }: SidebarProps) {
  const { user, signOut } = useAuth();
  const location = useLocation();

  const isInGroup = (g: NavGroup) =>
    g.children.some((c) => location.pathname.startsWith(c.to));

  const [healthOpen, setHealthOpen] = useState(() => isInGroup(HEALTH));
  const [settingsOpen, setSettingsOpen] = useState(() => isInGroup(SETTINGS));

  const initials = (user?.email ?? "?").split("@")[0].slice(0, 2).toUpperCase();
  const username = user?.email?.split("@")[0] ?? "";

  return (
    <>
      {/* Mobile backdrop */}
      <div
        aria-hidden
        onClick={onCloseMobile}
        className={cn(
          "fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity md:hidden",
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
          "flex transition-transform duration-200 ease-out md:static md:translate-x-0 md:flex",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center shadow-sm">
              <Activity className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground">DailyWork</span>
          </div>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation"
            className="md:hidden p-1.5 rounded-md hover:bg-sidebar-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          <SectionLabel>Workspace</SectionLabel>
          <div className="space-y-1">
            {PRIMARY.map((item) => (
              <NavItemLink key={item.to} {...item} />
            ))}
          </div>

          <SectionLabel>Health</SectionLabel>
          <NavGroupSection
            group={HEALTH}
            open={healthOpen}
            onToggle={() => setHealthOpen((o) => !o)}
          />

          <SectionLabel>Account</SectionLabel>
          <NavGroupSection
            group={SETTINGS}
            open={settingsOpen}
            onToggle={() => setSettingsOpen((o) => !o)}
          />
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-1 rounded-lg p-1 hover:bg-sidebar-accent/60 transition-colors">
            <NavLink
              to="/settings/profile"
              onClick={onCloseMobile}
              aria-label="Open profile settings"
              title="Profile settings"
              className="flex items-center gap-3 flex-1 min-w-0 rounded-md p-1.5 hover:bg-sidebar-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
            >
              <div
                className="h-9 w-9 shrink-0 rounded-full bg-primary/10 text-primary text-xs font-semibold ring-1 ring-primary/20 flex items-center justify-center"
                aria-hidden
              >
                {initials}
              </div>
              <div className="min-w-0 flex-1 text-left">
                <p className="text-sm font-medium truncate">{username}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {user?.email ?? ""}
                </p>
              </div>
            </NavLink>
            <button
              onClick={signOut}
              className="p-2 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 mt-4 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground first:mt-1">
      {children}
    </p>
  );
}

function NavItemLink({ to, label, icon: Icon }: NavItem) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-r before:bg-primary"
            : "text-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
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
        className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground transition-colors"
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
