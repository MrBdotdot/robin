import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Membership } from "@/types/database";

type Status = "loading" | "ready";
interface MembershipState {
  status: Status;
  membership: Membership | null;
}

/**
 * Subscribes to the current user's membership row. Calls bootstrap_membership
 * to guarantee a row exists on every sign-in (idempotent — returns the
 * existing row if there is one, creates a fresh one otherwise: first user
 * with no admin becomes admin, everyone else becomes participant).
 *
 * Consolidating the bootstrap into this hook removes the race condition
 * between a separate AuthGate-side bootstrap and a parallel membership
 * fetch — the bootstrap RPC IS the fetch.
 */
export function useMembership(): MembershipState {
  const [state, setState] = useState<MembershipState>({ status: "loading", membership: null });

  useEffect(() => {
    let active = true;

    const fetchMembership = async (userId: string | null) => {
      if (!userId) {
        if (active) setState({ status: "ready", membership: null });
        return;
      }
      // bootstrap_membership is SECURITY DEFINER, idempotent, and bypasses RLS.
      // It returns the existing membership row OR creates a new one for first sign-in.
      const { data, error } = await supabase.rpc("bootstrap_membership");
      if (!active) return;
      if (error) {
        // Bootstrap can legitimately fail (e.g. RPC not yet deployed, network).
        // Fall back to a direct SELECT so we still surface an existing row when possible.
        const { data: fallback } = await supabase
          .from("rr_memberships")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle();
        if (!active) return;
        setState({ status: "ready", membership: (fallback as Membership | null) ?? null });
        return;
      }
      setState({ status: "ready", membership: (data as Membership | null) ?? null });
    };

    supabase.auth.getSession().then(({ data }) => {
      fetchMembership(data.session?.user.id ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      fetchMembership(session?.user.id ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}

/**
 * Standalone wrapper around the bootstrap_membership RPC. Kept for callers
 * that want to fire it without subscribing (e.g. tests, future admin tools).
 * useMembership already calls this internally on every session change.
 */
export async function bootstrapMembership(): Promise<Membership> {
  const { data, error } = await supabase.rpc("bootstrap_membership");
  if (error) throw error;
  return data as Membership;
}
