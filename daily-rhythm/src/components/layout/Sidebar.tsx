import { Link, NavLink, useLocation } from "react-router-dom";
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
  Flame,
  Code2,
  LogOut,
  ChevronDown,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

/** Persist the desktop collapsed state so users keep their preferred layout
 *  between sessions. */
const COLLAPSED_KEY = "daily-rhythm-sidebar-collapsed";

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
  { to: "/", label: "Motivation", icon: Flame },
  { to: "/dashboard", label: "Dashboard", icon: Home },
  { to: "/daily-routine", label: "Daily Routine", icon: Activity },
  { to: "/todos", label: "Todos", icon: ListTodo },
  { to: "/gym", label: "Gym Workout", icon: Dumbbell },
  { to: "/coding-tracker", label: "Coding Tracker", icon: Code2 },
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

  // Desktop-only icon rail. On mobile the sidebar is a slide-in overlay and
  // collapsing it would defeat the purpose, so the collapsed state is only
  // honoured at md+ via Tailwind responsive classes below.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  });
  useEffect(() => {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const initials = (user?.email ?? "?").split("@")[0].slice(0, 2).toUpperCase();
  const username = user?.email?.split("@")[0] ?? "";
  const profileLabel = username || user?.email || "Profile";

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
          "fixed inset-y-0 left-0 z-50 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
          "flex transition-[width,transform] duration-200 ease-out md:static md:translate-x-0 md:flex",
          // Width: mobile always full 16rem; desktop toggles between 16rem and 4rem (icon rail).
          "w-64",
          collapsed ? "md:w-16" : "md:w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        <div
          className={cn(
            "border-b border-sidebar-border",
            collapsed
              ? "p-2 flex flex-col items-center gap-2"
              : "p-4 flex items-center justify-between gap-2"
          )}
        >
          <Link
            to="/"
            onClick={onCloseMobile}
            aria-label="Go to home"
            title="Home"
            className={cn(
              "flex items-center rounded-md hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors",
              collapsed ? "justify-center p-1" : "gap-2 -m-1 p-1"
            )}
          >
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center shadow-sm">
              <Activity className="h-4 w-4 text-primary-foreground" />
            </div>
            {!collapsed && (
              <span className="font-semibold text-foreground">DailyWork</span>
            )}
          </Link>

          {/* Desktop collapse / expand toggle */}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden md:inline-flex p-1.5 rounded-md hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>

          {/* Mobile close */}
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation"
            className="md:hidden p-1.5 rounded-md hover:bg-sidebar-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className={cn("flex-1 overflow-y-auto", collapsed ? "p-1.5" : "p-2")}>
          {collapsed ? (
            // Icon-rail layout — flat list, all groups inlined, no section
            // labels or chevrons (those don't fit a 64-px column).
            <div className="space-y-1">
              {PRIMARY.map((item) => (
                <NavItemLink key={item.to} {...item} collapsed />
              ))}
              <RailDivider />
              {HEALTH.children.map((child) => (
                <NavItemLink key={child.to} {...child} collapsed />
              ))}
              <RailDivider />
              {SETTINGS.children.map((child) => (
                <NavItemLink key={child.to} {...child} collapsed />
              ))}
            </div>
          ) : (
            <>
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
            </>
          )}
        </nav>

        <div className={cn("border-t border-sidebar-border", collapsed ? "p-2" : "p-3")}>
          {collapsed ? (
            // Compact column: avatar on top, sign-out below.
            <div className="flex flex-col items-center gap-1">
              <NavLink
                to="/settings/profile"
                onClick={onCloseMobile}
                aria-label={`Open profile settings — signed in as ${profileLabel}`}
                title={profileLabel}
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div
                  className="h-9 w-9 rounded-full bg-primary/10 text-primary text-xs font-semibold ring-1 ring-primary/20 flex items-center justify-center"
                  aria-hidden
                >
                  {initials}
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
          ) : (
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
          )}
        </div>
      </aside>
    </>
  );
}

/** Thin divider between the three nav clusters in the collapsed icon rail. */
function RailDivider() {
  return <div className="my-1.5 mx-2 border-t border-sidebar-border/70" aria-hidden />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 mt-4 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground first:mt-1">
      {children}
    </p>
  );
}

function NavItemLink({
  to,
  label,
  icon: Icon,
  collapsed = false,
}: NavItem & { collapsed?: boolean }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          "relative flex items-center rounded-md text-sm font-medium transition-colors",
          collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-r before:bg-primary"
            : "text-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span>{label}</span>}
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
