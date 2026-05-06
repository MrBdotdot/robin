import type { Membership, EventCollaborator } from "@/types/database";

export function isAdmin(m: Membership | null): boolean {
  return m?.role === "admin";
}

export function isScorekeeper(m: Membership | null): boolean {
  return m?.role === "scorekeeper";
}

export function isParticipant(m: Membership | null): boolean {
  return m?.role === "participant";
}

export function canCreateEvent(m: Membership | null): boolean {
  return isAdmin(m);
}

export function canEditEvent(m: Membership | null): boolean {
  return isAdmin(m);
}

export function canFinalizeEvent(m: Membership | null): boolean {
  return isAdmin(m);
}

export function canEditRoster(m: Membership | null): boolean {
  return isAdmin(m);
}

export function canSendInvites(m: Membership | null): boolean {
  return isAdmin(m);
}

export function canAssignScorekeepers(m: Membership | null): boolean {
  return isAdmin(m);
}

/**
 * True iff the user can edit scores on a specific event. Admin always;
 * scorekeeper iff they have an EventCollaborator row for that event.
 */
export function canScoreEvent(
  m: Membership | null,
  userId: string,
  eventId: string,
  collaborators: EventCollaborator[]
): boolean {
  if (isAdmin(m)) return true;
  if (!isScorekeeper(m)) return false;
  return collaborators.some((c) => c.user_id === userId && c.event_id === eventId);
}

/** Convenience: should we show edit/finalize/add-match buttons on event detail pages? */
export function canViewEditChrome(m: Membership | null): boolean {
  return isAdmin(m);
}
