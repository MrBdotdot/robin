import { NavLink, Outlet } from "react-router-dom";
import { CalendarDays, Users, Settings, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/series", label: "Series", icon: Layers },
  { to: "/players", label: "Players", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell() {
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      {/* Desktop sidebar (md+) */}
      <aside className="hidden border-r bg-card md:flex md:w-56 md:flex-col">
        <div className="flex h-14 items-center border-b px-5">
          <span className="font-display text-lg uppercase tracking-tight">
            Round Robin
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )
              }
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Mobile top bar (sm only) */}
      <header className="flex h-14 items-center justify-between border-b bg-card px-4 md:hidden">
        <span className="font-display text-base uppercase tracking-tight">
          Round Robin
        </span>
      </header>

      {/* Main content */}
      <main
        className={cn(
          "flex-1 overflow-y-auto",
          // bottom padding on mobile so the floating bottom nav doesn't clip content
          "pb-20 md:pb-0"
        )}
      >
        <Outlet />
      </main>

      {/* Mobile bottom nav (sm only) */}
      <nav
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex border-t bg-card md:hidden",
          // Safe-area padding for iOS home indicator
          "pb-[max(0.25rem,env(safe-area-inset-bottom))]"
        )}
      >
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 px-2 py-2 text-xs font-medium transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )
            }
          >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
