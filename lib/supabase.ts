import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_API_KEY!; // clé anon ok si RLS autorise insert/select
if (!url || !key) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_API_KEY");
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});
