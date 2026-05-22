import { useEffect, useState } from "react";
import { Loader2, Mail, ShieldCheck, Trophy, Layers } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth";
import { useMembership } from "@/lib/membership";
import { supabase } from "@/lib/supabase";
import type { EventCollaborator } from "@/types/database";

export default function Me() {
  const session = useSession();
  const { status, membership } = useMembership();
  const [collabs, setCollabs] = useState<EventCollaborator[]>([]);
  const [loadingCollabs, setLoadingCollabs] = useState(true);

  useEffect(() => {
    if (!session || session === "loading") return;
    supabase
      .from("rr_event_collaborators")
      .select("*")
      .eq("user_id", session.user.id)
      .then(({ data }) => {
        setCollabs((data as EventCollaborator[]) ?? []);
        setLoadingCollabs(false);
      });
  }, [session]);

  if (session === "loading" || status === "loading") {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!session) return null; // AuthGate should prevent this

  const email = session.user.email ?? "—";
  const role = membership?.role ?? "—";

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      {/* Header card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {email}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant="outline">{role}</Badge>
        </CardContent>
      </Card>

      {/* Network rating placeholder (filled in by sub-project 3). */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            Network rating
          </CardTitle>
          <CardDescription>Your rating against the friends you actually play with.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Coming soon — once you've been linked to your player profile and played some matches against other members, your network rating will show up here.
          </p>
        </CardContent>
      </Card>

      {/* Events you've played in (filled in by sub-project 2). */}
      <Card>
        <CardHeader>
          <CardTitle>Events you've played in</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            We haven't linked you to a player yet. Ask an admin to link your account to your player profile so your match history can show here.
          </p>
        </CardContent>
      </Card>

      {/* Series you've played in (filled in by sub-project 2). */}
      <Card>
        <CardHeader>
          <CardTitle>Series you've played in</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Same as above — show up here once you're linked to a player.
          </p>
        </CardContent>
      </Card>

      {/* Organizer assignments (visible only if you have any). */}
      {role === "organizer" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Events you can score
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingCollabs ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : collabs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No assignments yet. The admin will let you know when there's an event for you to score.
              </p>
            ) : (
              <ul className="space-y-2">
                {collabs.map((c) => (
                  <li key={c.id} className="rounded border p-2 text-sm">
                    <a href={`/events/${c.event_id}`} className="font-medium hover:underline">
                      Event {c.event_id.slice(0, 8)}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <div className="text-center text-xs text-muted-foreground">
        <Mail className="mr-1 inline h-3 w-3" />
        Need help? Ask the admin who invited you.
      </div>
    </div>
  );
}
