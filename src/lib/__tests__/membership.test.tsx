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

const mockBootstrap = (role: string | null) => {
  (supabase.rpc as any).mockResolvedValue({
    data: role
      ? { id: "m1", user_id: "u1", role, created_at: "now" }
      : null,
    error: null,
  });
};

const mockBootstrapError = () => {
  (supabase.rpc as any).mockResolvedValue({ data: null, error: new Error("rpc failed") });
};

const mockFallbackSelect = (role: string | null) => {
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

  it("returns the membership row from bootstrap RPC for a signed-in user", async () => {
    mockSession("u1");
    mockBootstrap("admin");
    const { result } = renderHook(() => useMembership());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.membership?.role).toBe("admin");
  });

  it("falls back to direct SELECT when bootstrap RPC errors", async () => {
    mockSession("u1");
    mockBootstrapError();
    mockFallbackSelect("organizer");
    const { result } = renderHook(() => useMembership());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.membership?.role).toBe("organizer");
  });

  it("returns null when bootstrap errors and fallback finds no row", async () => {
    mockSession("u1");
    mockBootstrapError();
    mockFallbackSelect(null);
    const { result } = renderHook(() => useMembership());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.membership).toBeNull();
  });
});
