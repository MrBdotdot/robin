import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/**
 * Thin wrappers around supabase.auth for email + password accounts.
 *
 * Note: this gates the app at the UI layer only. Anyone with a Supabase
 * Auth user can still read/write every rr_* table because RLS hasn't
 * been tightened yet. The full owner-scoped + invite + claim plan lives
 * in AUTH_PLAN.md.
 */

type SessionState = Session | null | "loading";

/**
 * Subscribes to the current Supabase auth session. Returns "loading"
 * during the initial fetch so the gate can avoid a flash of the sign-in
 * form for already-signed-in users.
 */
export function useSession(): SessionState {
  const [session, setSession] = useState<SessionState>("loading");

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      if (active) setSession(s);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return session;
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
