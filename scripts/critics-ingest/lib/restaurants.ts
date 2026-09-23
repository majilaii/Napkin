/**
 * Restaurant loaders for the critics ingest scraper.
 * TICKET-033
 *
 * Scope is "user-touched" restaurants: referenced by at least one entry or
 * wishlist_item. Both restaurant_id columns are nullable. An entry can point
 * at a place instead of a restaurant, and a wishlist row stays NULL while its
 * import job resolves (and for good if the job fails). Those rows have no
 * restaurant to scrape, so they are skipped.
 *
 * A NULL must never reach `.in('id', ...)`: postgrest-js sends it as the bare
 * word `null`, Postgres rejects it as a uuid, and the whole run dies before
 * scraping anything. Every daily drip from 2026-07-11 failed that way with
 * `invalid input syntax for type uuid: "null"`.
 */

import type { SupabaseClient } from './supabase.ts';

export const DRIP_BATCH_SIZE = 50;
export const SCRAPE_STALENESS_DAYS = 30;

export interface RestaurantRow {
    id: string;
    name: string;
    address: string | null;
    external_id: string | null;
}

/** Distinct restaurant ids, in first-seen order, with NULL references dropped. */
export function distinctRestaurantIds(rows: Array<{ restaurant_id: string | null }>): string[] {
    const ids = new Set<string>();
    for (const row of rows) {
        if (row.restaurant_id) ids.add(row.restaurant_id);
    }
    return [...ids];
}

/** Restaurant ids referenced by at least one entry or wishlist_item. */
async function loadTouchedRestaurantIds(supabase: SupabaseClient): Promise<string[]> {
    const { data: entryRests, error: entryErr } = await supabase
        .from('entries')
        .select('restaurant_id')
        .not('restaurant_id', 'is', null);
    if (entryErr) throw new Error(entryErr.message);

    const { data: wishlistRests, error: wlErr } = await supabase
        .from('wishlist_items')
        .select('restaurant_id')
        .not('restaurant_id', 'is', null);
    if (wlErr) throw new Error(wlErr.message);

    return distinctRestaurantIds([...(entryRests ?? []), ...(wishlistRests ?? [])]);
}

async function loadRestaurantsById(supabase: SupabaseClient, ids: string[]): Promise<RestaurantRow[]> {
    if (ids.length === 0) return [];

    const { data: restaurants, error: restErr } = await supabase
        .from('restaurants')
        .select('id, name, address, external_id')
        .in('id', ids);
    if (restErr) throw new Error(restErr.message);

    return (restaurants ?? []) as RestaurantRow[];
}

/** User-touched restaurants: at least one entry or wishlist_item. */
export async function loadUserTouchedRestaurants(supabase: SupabaseClient): Promise<RestaurantRow[]> {
    return loadRestaurantsById(supabase, await loadTouchedRestaurantIds(supabase));
}

/**
 * Drip-eligible restaurants: user-touched, with no attempt for this publication
 * in the last 30 days (or no attempt at all). Bounded to DRIP_BATCH_SIZE per
 * publication, taken in touched-id order (entries first, then wishlist_items).
 * P1-3 ARCH-REVIEW: queries critic_scrape_attempts, not professional_critic_reviews.
 */
export async function loadDripRestaurants(supabase: SupabaseClient, publication: string): Promise<RestaurantRow[]> {
    const staleBefore = new Date(Date.now() - SCRAPE_STALENESS_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: recentAttempts, error: attErr } = await supabase
        .from('critic_scrape_attempts')
        .select('restaurant_id')
        .eq('publication', publication)
        .gte('last_attempted_at', staleBefore);
    if (attErr) throw new Error(attErr.message);

    const recentIds = new Set((recentAttempts ?? []).map((a: { restaurant_id: string }) => a.restaurant_id));

    // Eligible = touched AND not recently attempted
    const eligibleIds = (await loadTouchedRestaurantIds(supabase))
        .filter((id) => !recentIds.has(id))
        .slice(0, DRIP_BATCH_SIZE);

    return loadRestaurantsById(supabase, eligibleIds);
}
