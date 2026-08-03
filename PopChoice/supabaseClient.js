import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error(
    'VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are missing. Copy .env.example to .env.'
  );
}

/**
 * Browser client. Read-only in practice: RLS on popchoice_movies grants anon a
 * SELECT policy and nothing else, and the table grants are narrowed to SELECT
 * as well, so inserts from here are refused twice over. Seeding goes through
 * ingest.js.
 */
export default createClient(url, publishableKey);
