import { describe, expect, it } from "vitest";
import {
  canCreateEvent,
  canEditEvent,
  canScoreEvent,
  canViewEditChrome,
  isAdmin,
  isOrganizer,
  isParticipant,
} from "../permissions";
import type { Membership, EventCollaborator } from "@/types/database";

const m = (role: Membership["role"]): Membership => ({
  id: "m",
  user_id: "u",
  role,
  created_at: "",
});

describe("permissions", () => {
  describe("isAdmin / isOrganizer / isParticipant", () => {
    it("admin", () => {
      expect(isAdmin(m("admin"))).toBe(true);
      expect(isAdmin(m("organizer"))).toBe(false);
      expect(isAdmin(null)).toBe(false);
    });
    it("organizer", () => {
      expect(isOrganizer(m("organizer"))).toBe(true);
      expect(isOrganizer(m("admin"))).toBe(false);
    });
    it("participant", () => {
      expect(isParticipant(m("participant"))).toBe(true);
      expect(isParticipant(m("admin"))).toBe(false);
    });
  });

  describe("canCreateEvent", () => {
    it("admin only", () => {
      expect(canCreateEvent(m("admin"))).toBe(true);
      expect(canCreateEvent(m("organizer"))).toBe(false);
      expect(canCreateEvent(m("participant"))).toBe(false);
      expect(canCreateEvent(null)).toBe(false);
    });
  });

  describe("canEditEvent", () => {
    it("admin only", () => {
      expect(canEditEvent(m("admin"))).toBe(true);
      expect(canEditEvent(m("organizer"))).toBe(false);
    });
  });

  describe("canScoreEvent", () => {
    const collab = (userId: string, eventId: string): EventCollaborator => ({
      id: "c",
      user_id: userId,
      event_id: eventId,
      granted_by: "g",
      granted_at: "",
    });

    it("admin can score any event", () => {
      expect(canScoreEvent(m("admin"), "u", "e1", [])).toBe(true);
    });
    it("organizer with collaborator row for the event", () => {
      expect(canScoreEvent(m("organizer"), "u", "e1", [collab("u", "e1")])).toBe(true);
    });
    it("organizer without collaborator row for the event", () => {
      expect(canScoreEvent(m("organizer"), "u", "e1", [collab("u", "e2")])).toBe(false);
    });
    it("participant cannot score", () => {
      expect(canScoreEvent(m("participant"), "u", "e1", [collab("u", "e1")])).toBe(false);
    });
    it("no membership cannot score", () => {
      expect(canScoreEvent(null, "u", "e1", [])).toBe(false);
    });
  });

  describe("canViewEditChrome", () => {
    it("admin shows edit chrome", () => {
      expect(canViewEditChrome(m("admin"))).toBe(true);
    });
    it("non-admin hides edit chrome", () => {
      expect(canViewEditChrome(m("organizer"))).toBe(false);
      expect(canViewEditChrome(m("participant"))).toBe(false);
      expect(canViewEditChrome(null)).toBe(false);
    });
  });
});
