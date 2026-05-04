import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !key) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
      "Copy .env.example to .env.local and fill in the values."
  );
}

// Untyped client. We tried generic-typing with our hand-written `Database`
// type, but supabase-js v2.105+ requires a stricter Database shape than is
// worth maintaining by hand. Type safety on rows is preserved at call sites
// via explicit `as` casts and the local TypeScript types in `@/types/database`.
export const supabase: SupabaseClient = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
