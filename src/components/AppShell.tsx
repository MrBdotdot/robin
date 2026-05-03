import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  CalendarDays,
  Home,
  Layers,
  MoreHorizontal,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";

const PRIMARY_NAV = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/events", label: "Events", icon: CalendarDays, end: false },
  { to: "/series", label: "Series", icon: Layers, end: false },
] as const;

const SECONDARY_NAV = [
  { to: "/players", label: "Players", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell() {
  // Desktop sidebar popover and mobile bottom-sheet are independent so
  // viewport-specific opens don't bleed into each other.
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopoverOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen]);

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="hidden border-r bg-card md:flex md:w-56 md:flex-col">
        <div className="flex h-14 items-center border-b px-5">
          <span className="font-display text-lg uppercase tracking-tight">
            Round Robin
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {PRIMARY_NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
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
        <div ref={popoverRef} className="relative border-t p-3">
          <button
            type="button"
            onClick={() => setPopoverOpen((v) => !v)}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              popoverOpen
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
            aria-haspopup="menu"
            aria-expanded={popoverOpen}
          >
            <MoreHorizontal className="h-4 w-4" />
            <span>More</span>
          </button>
          {popoverOpen && (
            <div
              role="menu"
              className="absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-md border bg-card shadow-lg"
            >
              {SECONDARY_NAV.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setPopoverOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors",
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
            </div>
          )}
        </div>
      </aside>

      <header className="flex h-14 items-center justify-between border-b bg-card px-4 md:hidden">
        <span className="font-display text-base uppercase tracking-tight">
          Round Robin
        </span>
      </header>

      <main className={cn("flex-1 overflow-y-auto", "pb-20 md:pb-0")}>
        <Outlet />
      </main>

      <nav
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex border-t bg-card md:hidden",
          "pb-[max(0.25rem,env(safe-area-inset-bottom))]"
        )}
      >
        {PRIMARY_NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
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
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 px-2 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          aria-haspopup="dialog"
        >
          <MoreHorizontal className="h-5 w-5" />
          <span>More</span>
        </button>
      </nav>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="More">
        <ul className="-mx-2 flex flex-col">
          {SECONDARY_NAV.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                onClick={() => setSheetOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-accent"
                  )
                }
              >
                <Icon className="h-5 w-5" />
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  );
}
