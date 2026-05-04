import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/**
 * Magic-link auth wrappers. Phase 2: replaces email/password.
 *
 * Sign-in flow:
 *   1. User enters email, app calls signInWithMagicLink().
 *   2. Supabase emails them a one-time link.
 *   3. They click; the app loads with a session in the URL hash.
 *   4. supabase-js detects the session and fires onAuthStateChange.
 *   5. AuthGate's session subscription updates and renders children.
 */

type SessionState = Session | null | "loading";

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

export async function signInWithMagicLink(email: string, redirectTo?: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: redirectTo ?? window.location.origin,
    },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
