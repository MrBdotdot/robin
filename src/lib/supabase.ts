import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !key) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
      "Copy .env.example to .env.local and fill in the values."
  );
}

export const supabase = createClient<Database>(url, key, {
  auth: {
    // We don't use Supabase Auth (we have our own password gate),
    // so disable session persistence to keep things tidy.
    persistSession: false,
    autoRefreshToken: false,
  },
});
