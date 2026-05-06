import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Membership } from "@/types/database";

type Status = "loading" | "ready";
interface MembershipState {
  status: Status;
  membership: Membership | null;
}

/**
 * Subscribes to the current user's membership row. Returns null when
 * not signed in or when the user has no row yet (e.g. first sign-in
 * before bootstrap_membership has run).
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
      const { data, error } = await supabase
        .from("rr_memberships")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (!active) return;
      if (error) {
        // RLS may block this for anon users; treat as "no membership".
        setState({ status: "ready", membership: null });
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
 * Calls the bootstrap_membership RPC. Idempotent — safe to call on every sign-in.
 * First signed-in user with no admin existing becomes admin; everyone else becomes participant.
 */
export async function bootstrapMembership(): Promise<Membership> {
  const { data, error } = await supabase.rpc("bootstrap_membership");
  if (error) throw error;
  return data as Membership;
}
