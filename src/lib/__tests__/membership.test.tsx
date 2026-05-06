import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useMembership } from "../membership";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import { supabase } from "@/lib/supabase";

const mockSession = (userId: string | null) => {
  (supabase.auth.getSession as any).mockResolvedValue({
    data: { session: userId ? { user: { id: userId } } : null },
  });
};

const mockMembershipRow = (role: string | null) => {
  (supabase.from as any).mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: role ? { id: "m1", user_id: "u1", role, created_at: "now" } : null,
          error: null,
        }),
      }),
    }),
  });
};

describe("useMembership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no session", async () => {
    mockSession(null);
    const { result } = renderHook(() => useMembership());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.membership).toBeNull();
  });

  it("returns the membership row for a signed-in user", async () => {
    mockSession("u1");
    mockMembershipRow("admin");
    const { result } = renderHook(() => useMembership());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.membership?.role).toBe("admin");
  });

  it("returns null membership when user has no row yet", async () => {
    mockSession("u1");
    mockMembershipRow(null);
    const { result } = renderHook(() => useMembership());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.membership).toBeNull();
  });
});
