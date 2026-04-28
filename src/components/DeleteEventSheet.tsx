import { useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { EventRow } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";

interface DeleteEventSheetProps {
  open: boolean;
  onClose: () => void;
  event: EventRow | null;
  onDeleted: () => Promise<void> | void;
}

export function DeleteEventSheet({
  open,
  onClose,
  event,
  onDeleted,
}: DeleteEventSheetProps) {
  const [saving, setSaving] = useState(false);

  if (!event) return null;

  const handleDelete = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("rr_events")
        .delete()
        .eq("id", event.id);
      if (error) throw error;
      toast.success("Event deleted");
      onClose();
      await onDeleted();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't delete event", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Delete event"
      description={event.name}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={saving}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={saving}
            className="flex-1"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Delete event
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">This deletes everything in this event.</p>
            <p className="mt-1 text-muted-foreground">
              All scheduled and completed matches, the roster, and the event's
              rating-history rows will be removed. Player profiles and lifetime
              ratings stay intact, but this event will no longer count toward
              their stats.
            </p>
            <p className="mt-2 text-muted-foreground">
              This can't be undone.
            </p>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
