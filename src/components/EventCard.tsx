import { Link } from "react-router-dom";
import { CalendarDays, Trash2, Trophy, Users } from "lucide-react";
import type { EventRow } from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface EventCardProps {
  event: EventRow;
  featured?: boolean;
  playerCount?: number;
  onDelete?: (eventId: string) => void;
}

const FORMAT_LABEL: Record<EventRow["format"], string> = {
  pure_rr: "Round robin",
  rr_knockout: "RR → Knockout",
  rr_final_bronze: "RR → Final + Bronze",
};

const MODE_LABEL: Record<EventRow["mode"], string> = {
  singles: "Singles",
  doubles_americano: "Doubles",
};

function StatusBadge({ status }: { status: EventRow["status"] }) {
  switch (status) {
    case "draft":
      return <Badge variant="draft">Draft</Badge>;
    case "live":
      return <Badge variant="live">Live</Badge>;
    case "completed":
      return <Badge variant="completed">Completed</Badge>;
    case "archived":
      return <Badge variant="outline">Archived</Badge>;
  }
}

export function EventCard({
  event,
  featured,
  playerCount,
  onDelete,
}: EventCardProps) {
  const dateLabel = formatDate(event.scheduled_date) ?? formatDate(event.created_at);

  return (
    <Link to={`/events/${event.id}`} className="block focus:outline-none">
      <div
        className={cn(
          "bento-card group relative overflow-hidden transition-colors",
          "hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring",
          featured && "min-h-[180px] border-2",
          featured && event.status === "live"
            ? "bg-accent text-accent-foreground hover:bg-accent"
            : featured
            ? "bg-primary text-primary-foreground hover:bg-primary"
            : ""
        )}
      >
        <div
          className={cn(
            "flex items-start justify-between gap-3 p-5",
            featured && "pb-3"
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Trophy
                className={cn(
                  "shrink-0",
                  featured ? "h-5 w-5" : "h-4 w-4 text-muted-foreground"
                )}
              />
              <h3
                className={cn(
                  "truncate",
                  featured
                    ? "font-display text-xl uppercase tracking-tight"
                    : "text-base font-bold"
                )}
              >
                {event.name}
              </h3>
            </div>
            <p
              className={cn(
                "mt-1 truncate text-sm",
                featured ? "opacity-90" : "text-muted-foreground"
              )}
            >
              {event.sport} · {MODE_LABEL[event.mode]}
            </p>
            {!featured && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {FORMAT_LABEL[event.format]}
              </p>
            )}
          </div>
          {!featured && <StatusBadge status={event.status} />}
        </div>

        {featured && (
          <div className="px-5 pb-2">
            <p className="pantone-label">{FORMAT_LABEL[event.format]}</p>
          </div>
        )}

        <div
          className={cn(
            "flex items-center justify-between gap-3 px-5 py-3 text-xs",
            featured ? "border-t border-foreground/20" : "border-t text-muted-foreground"
          )}
        >
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" />
              {dateLabel ?? "No date set"}
            </span>
            {playerCount != null && (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {playerCount}
              </span>
            )}
          </div>
          {onDelete && (
            <button
              type="button"
              aria-label="Delete event"
              title="Delete event"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(event.id);
              }}
              className={cn(
                "rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                featured
                  ? "hover:bg-foreground/10"
                  : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              )}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}
