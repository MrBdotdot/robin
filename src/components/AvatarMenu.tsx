import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LogOut, Settings as SettingsIcon, UserPlus, User as UserIcon } from "lucide-react";
import { useSession, signOut } from "@/lib/auth";
import { useMembership } from "@/lib/membership";
import { isAdmin } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { InviteSheet } from "@/components/InviteSheet";

export function AvatarMenu() {
  const session = useSession();
  const { membership } = useMembership();
  const [open, setOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!session || session === "loading") return null;
  const email = session.user.email ?? "";
  const initial = email.charAt(0).toUpperCase() || "?";

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90"
          aria-label="Account menu"
        >
          {initial}
        </button>
        {open && (
          <div
            className={cn(
              "absolute right-0 top-10 z-50 w-56 rounded-md border bg-popover p-1 shadow-lg"
            )}
          >
            <div className="px-3 py-2 text-xs text-muted-foreground">
              <div className="truncate font-medium text-foreground">{email}</div>
              <div className="text-[10px] uppercase tracking-wide">{membership?.role ?? "—"}</div>
            </div>
            <div className="my-1 h-px bg-border" />
            <Link
              to="/me"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-muted"
            >
              <UserIcon className="h-4 w-4" />
              My profile
            </Link>
            {isAdmin(membership) && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setInviteOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <UserPlus className="h-4 w-4" />
                Invite someone
              </button>
            )}
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-muted"
            >
              <SettingsIcon className="h-4 w-4" />
              Settings
            </Link>
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                await signOut();
                window.location.href = "/";
              }}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-destructive hover:bg-muted"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        )}
      </div>
      <InviteSheet open={inviteOpen} onOpenChange={setInviteOpen} />
    </>
  );
}
