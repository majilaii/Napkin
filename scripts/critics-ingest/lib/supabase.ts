/**
 * Service-role Supabase client factory for the critics ingest scraper.
 * TICKET-033
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from environment.
 * These are injected as GitHub Actions secrets in the workflow.
 *
 * The service-role key bypasses RLS. The scraper only writes to:
 *   - professional_critic_reviews (INSERT/UPDATE)
 *   - critic_scrape_attempts (INSERT/UPDATE)
 * And reads from:
 *   - restaurants, entries, wishlist_items (SELECT)
 *
 * A least-privilege Postgres role for ingestion is deferred to TICKET-033b.
 */

// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
    if (_client) return _client;

    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!url) throw new Error('SUPABASE_URL environment variable is not set');
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is not set');

    _client = createClient(url, key, {
        auth: { persistSession: false },
    });
    return _client;
}

/** Re-export type for callers that need it without importing supabase-js directly */
export type { SupabaseClient };
