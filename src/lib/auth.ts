/**
 * Tiny password gate. The expected password is read from VITE_APP_PASSWORD
 * (defaults to "415" for testing). Once the user enters it correctly, we
 * stash a flag in sessionStorage so we don't pester them every page load.
 *
 * This is testing-grade auth. The real access control before going public
 * should be Supabase Auth + RLS policies tied to authenticated users.
 */

const STORAGE_KEY = "rr_unlocked";
const EXPECTED = (import.meta.env.VITE_APP_PASSWORD as string | undefined) ?? "415";

export function isUnlocked(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private mode / storage disabled — fall back to "not unlocked"
    return false;
  }
}

export function tryUnlock(input: string): boolean {
  if (input.trim() === EXPECTED) {
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore — they'll just have to re-enter on each page load
    }
    return true;
  }
  return false;
}

export function lock(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
