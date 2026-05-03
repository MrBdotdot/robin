import { useEffect, useState } from "react";
import {
  LogOut,
  Moon,
  Sun,
  Trash2,
  AlertTriangle,
  Loader2,
  Sparkles,
  Download,
  UserCircle2,
} from "lucide-react";
import { downloadJson } from "@/lib/export";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { signOut, useSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const DARK_KEY = "rr_theme_dark";

export default function Settings() {
  const session = useSession();
  const email =
    session && session !== "loading" ? session.user.email ?? null : null;
  const [dark, setDark] = useState<boolean>(false);
  const [wiping, setWiping] = useState(false);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Initialize dark mode from storage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(DARK_KEY);
      const isDark = stored === "1";
      setDark(isDark);
      document.documentElement.classList.toggle("dark", isDark);
    } catch {
      // ignore
    }
  }, []);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(DARK_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const [
        { data: events },
        { data: players },
        { data: pairs },
        { data: eventPlayers },
        { data: matches },
        { data: ratingHistory },
        { data: pairRatingHistory },
      ] = await Promise.all([
        supabase.from("rr_events").select("*"),
        supabase.from("rr_players").select("*"),
        supabase.from("rr_pairs").select("*"),
        supabase.from("rr_event_players").select("*"),
        supabase.from("rr_matches").select("*"),
        supabase.from("rr_rating_history").select("*"),
        supabase.from("rr_pair_rating_history").select("*"),
      ]);
      const filename = `round-robin-${new Date().toISOString().slice(0, 10)}.json`;
      downloadJson(filename, {
        exportedAt: new Date().toISOString(),
        events: events ?? [],
        players: players ?? [],
        pairs: pairs ?? [],
        eventPlayers: eventPlayers ?? [],
        matches: matches ?? [],
        ratingHistory: ratingHistory ?? [],
        pairRatingHistory: pairRatingHistory ?? [],
      });
      toast.success("Database exported", {
        description: `Saved as ${filename}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't export", { description: msg });
    } finally {
      setExporting(false);
    }
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      // AuthGate will re-render the sign-in form via the auth state listener.
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't sign out", { description: msg });
    } finally {
      setSigningOut(false);
    }
  };

  const handleWipe = async () => {
    if (wiping) return;
    setWiping(true);
    try {
      // Delete order matters because of FK constraints. Kids first.
      await supabase.from("rr_audit_log").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("rr_pair_rating_history").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("rr_rating_history").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("rr_matches").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("rr_event_players").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("rr_events").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("rr_pairs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("rr_players").delete().neq("id", "00000000-0000-0000-0000-000000000000");

      toast.success("All data wiped", {
        description: "The database has been reset. Re-seed players if needed.",
      });
      setConfirmingWipe(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't wipe data", { description: msg });
    } finally {
      setWiping(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <h1 className="text-3xl uppercase">Settings</h1>
        <p className="text-sm text-muted-foreground">
          App-level preferences.
        </p>
      </header>

      <div className="space-y-4">
        {/* Theme */}
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                {dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                Appearance
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {dark ? "Dark mode is on." : "Light mode (cream surface, peach accents)."}
              </p>
            </div>
            <Button variant="outline" onClick={toggleDark}>
              Switch to {dark ? "light" : "dark"}
            </Button>
          </div>
        </Card>

        {/* Account */}
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <UserCircle2 className="h-4 w-4" />
                Account
              </h2>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {email ?? "Not signed in"}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handleSignOut}
              disabled={signingOut || !email}
            >
              {signingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              Sign out
            </Button>
          </div>
        </Card>

        {/* Export */}
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Download className="h-4 w-4" />
                Export data
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Download every event, player, match, and rating row as a single JSON file.
              </p>
            </div>
            <Button variant="outline" onClick={handleExport} disabled={exporting}>
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Export
            </Button>
          </div>
        </Card>

        {/* About */}
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4" />
            About
          </h2>
          <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
            <li>Round-robin tournament tracker.</li>
            <li>Glicko-2 ratings, per-player and per-pair history.</li>
            <li>Mobile-first. Built for one-thumb scoring at the venue.</li>
          </ul>
        </Card>

        {/* Danger zone */}
        <Card className="border-destructive/30 bg-destructive/5 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Danger zone
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Wipe all events, players, matches, and ratings. Useful while testing — irreversible.
          </p>

          {confirmingWipe ? (
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium text-destructive">
                This will permanently delete every row in every table. Are you sure?
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={() => setConfirmingWipe(false)}
                  disabled={wiping}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleWipe}
                  disabled={wiping}
                  className="flex-1"
                >
                  {wiping ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Yes, wipe everything
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="destructive"
              onClick={() => setConfirmingWipe(true)}
              className="mt-4"
            >
              <Trash2 className="h-4 w-4" />
              Wipe all data
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
}
