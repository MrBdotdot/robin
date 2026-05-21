import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet } from "@/components/ui/sheet";
import { supabase } from "@/lib/supabase";
import type { EventCollaborator, Membership } from "@/types/database";

interface Props {
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange?: () => void;
}

interface MemberWithEmail extends Membership {
  email: string | null;
}

export function AssignScorekeepersSheet({ eventId, open, onOpenChange, onChange }: Props) {
  const [scorekeepers, setScorekeepers] = useState<MemberWithEmail[]>([]);
  const [collaborators, setCollaborators] = useState<EventCollaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // user_id being toggled

  const load = async () => {
    setLoading(true);
    // list_scorekeepers_with_email() is a security-definer RPC that does an
    // admin check inline (only admins receive rows). Replaces the previous
    // rr_memberships_with_email view which exposed auth.users emails too broadly.
    const { data: m, error: mErr } = await supabase.rpc("list_scorekeepers_with_email");
    const { data: c, error: cErr } = await supabase
      .from("rr_event_collaborators")
      .select("*")
      .eq("event_id", eventId);
    if (mErr || cErr) {
      toast.error(mErr?.message ?? cErr?.message ?? "Could not load");
      setLoading(false);
      return;
    }
    setScorekeepers((m as MemberWithEmail[]) ?? []);
    setCollaborators((c as EventCollaborator[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (open) load();
  }, [open, eventId]);

  const isAssigned = (userId: string) =>
    collaborators.some((c) => c.user_id === userId);

  const toggle = async (userId: string) => {
    setSaving(userId);
    try {
      if (isAssigned(userId)) {
        const { error } = await supabase
          .from("rr_event_collaborators")
          .delete()
          .eq("event_id", eventId)
          .eq("user_id", userId);
        if (error) throw error;
        setCollaborators((prev) => prev.filter((c) => c.user_id !== userId));
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("not signed in");
        const { data, error } = await supabase
          .from("rr_event_collaborators")
          .insert({ event_id: eventId, user_id: userId, granted_by: user.id })
          .select()
          .single();
        if (error) throw error;
        setCollaborators((prev) => [...prev, data as EventCollaborator]);
      }
      onChange?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={() => onOpenChange(false)}
      title="Scorekeepers for this event"
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : scorekeepers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No members have the scorekeeper role yet. Invite someone with the scorekeeper role from the avatar menu.
        </p>
      ) : (
        <div className="space-y-2">
          {scorekeepers.map((m) => (
            <label
              key={m.id}
              className="flex cursor-pointer items-center justify-between rounded-md border p-3 text-sm"
            >
              <div>
                <div className="font-medium">{m.email ?? "(unknown)"}</div>
                <div className="text-xs text-muted-foreground">scorekeeper</div>
              </div>
              <input
                type="checkbox"
                checked={isAssigned(m.user_id)}
                disabled={saving === m.user_id}
                onChange={() => toggle(m.user_id)}
              />
            </label>
          ))}
        </div>
      )}
    </Sheet>
  );
}
