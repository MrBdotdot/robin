import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { EventRow } from "@/types/database";
import { cloneEvent } from "@/lib/cloneEvent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet } from "@/components/ui/sheet";

interface CloneEventSheetProps {
  open: boolean;
  onClose: () => void;
  event: EventRow;
  rosterCount: number;
}

export function CloneEventSheet({
  open,
  onClose,
  event,
  rosterCount,
}: CloneEventSheetProps) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [includeRoster, setIncludeRoster] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(`${event.name} (copy)`);
      setDate(new Date().toISOString().slice(0, 10));
      setIncludeRoster(true);
    }
  }, [open, event]);

  const handleClone = async () => {
    if (saving) return;
    if (!name.trim()) {
      toast.error("Name can't be empty.");
      return;
    }
    setSaving(true);
    try {
      const newId = await cloneEvent(event.id, {
        includeRoster,
        newName: name.trim(),
        newDate: date || null,
      });
      toast.success("Event duplicated", {
        description: includeRoster
          ? `${rosterCount} player${rosterCount === 1 ? "" : "s"} carried over.`
          : "Empty roster — add players in the new event.",
      });
      onClose();
      navigate(`/events/${newId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't duplicate", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Duplicate event"
      description="Create a draft copy of this event's settings."
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
          <Button onClick={handleClone} disabled={saving} className="flex-1">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            Duplicate
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="clone-name">New event name</Label>
          <Input
            id="clone-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="clone-date">Date</Label>
          <Input
            id="clone-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <button
          type="button"
          onClick={() => setIncludeRoster(!includeRoster)}
          className="flex w-full items-center justify-between rounded-lg border bg-background p-4 text-left transition-colors hover:bg-accent/40"
        >
          <span>
            <span className="block text-sm font-medium">
              Copy roster
            </span>
            <span className="block text-xs text-muted-foreground">
              {rosterCount} player{rosterCount === 1 ? "" : "s"} from this event
            </span>
          </span>
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
              includeRoster
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background"
            }`}
            aria-hidden
          >
            {includeRoster && <Check className="h-3 w-3" />}
          </span>
        </button>

        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          Carries over: scoring rules, format, knockout depth, courts, tiebreakers,
          seeding strategy. Schedule, scores, and final standings are not copied —
          the new event starts as a draft.
        </div>
      </div>
    </Sheet>
  );
}
