/**
 * public-browse: read-only public layer for signed-out guests (TICKET-247).
 *
 * App Store Guideline 5.1.1(v): non-account features must be reachable without
 * registering. This function is what a guest can read. It deliberately does NOT
 * call auth.getUser: the gateway already verified the bearer is a valid JWT
 * (the anon key, or any user token), and nothing here depends on who is asking.
 *
 * What it exposes, and only this:
 *   - verified, non-tombstoned restaurants (an explicit column allowlist)
 *   - public-eligible reviews (is_entry_publicly_eligible: public account,
 *     visibility <> 'private', rated, a real note) via service_role-only RPCs
 *   - public lists of public accounts, never Table or private lists, with their
 *     verified entries only (fn_guest_public_list, fn_restaurant_featured_lists
 *     with a NULL viewer)
 *
 * What it never reads: Table rosters or Table content, wishlists, follows,
 * blocked_users, private entries or private lists, self history. Everything a
 * guest sees here is already visible to any signed-in stranger.
 *
 * Cost control: every call is rate-limited per client IP through the existing
 * check_and_increment_rate_limit bucket, keyed by a daily-salted SHA-256 of the
 * IP folded into a uuid (never the raw address). Fail-closed like places-search.
 * No Google call happens on this path.
 *
 * Actions (POST, JSON body; `action` may also ride the query string):
 *   { action: 'search', q }                 → { data: { rows: GuestRestaurantRow[] } }
 *   { action: 'recent' }                    → { data: { rows: GuestRestaurantRow[] } }
 *   { action: 'page', restaurant_id }       → { data: { restaurant, reviews, reviews_total, featured_lists } }
 *   { action: 'reviews', restaurant_id, cursor?, limit? } → { data: Page<PublicReviewCard> }
 *   { action: 'list', list_id }             → { data: ListDetailData } for a public list, else 404
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { reportError } from '../_shared/report.ts';
import { buildPage, decodeCursor } from '../_shared/pagination.ts';
import { resolveRestaurantLookupId } from '../_shared/canonicalRestaurant.ts';
import { loadReviewPhotos } from '../_shared/reviewPhotos.ts';
import { guestBucketId } from './guestBucket.ts';
import { guestSafePhoto, toGuestRow } from './guestProjection.ts';

// ── Allowlists ───────────────────────────────────────────────────────────────
// The list-row projection (search / recent). Public catalogue facts only.
const ROW_COLUMNS =
    'id, name, city, country, address, cuisine, price_level, photo_url, photo_source, '
    + 'places_photo_attribution_html, google_rating, google_rating_count';

// The page projection: byte-identical to restaurant-history?action=page's
// restaurant select so the client can reuse RestaurantPageRestaurant.
const PAGE_COLUMNS =
    'id, name, address, city, country, cuisine, price_level, photo_url, google_rating, '
    + 'google_rating_count, external_id, lat, lng, photo_source, places_photo_attribution_html, '
    + 'phone, website, google_maps_uri, hours, places_synced_at, place_types, reserve_url, '
    + 'reserve_url_checked_at';

const SEARCH_LIMIT = 20;
const RECENT_LIMIT = 20;
const PAGE_PREVIEW_REVIEWS = 3;
const GUEST_RATE_MAX = 240;
const GUEST_RATE_WINDOW_SECONDS = 3600;

const MAX_RESTAURANT_ID_LENGTH = 512;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Helpers ──────────────────────────────────────────────────────────────────
function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function fail(code: string, message: string, status = 400) {
    return json({ error: { code, message } }, status);
}

// deno-lint-ignore no-explicit-any
async function reviewCounts(supabase: any, ids: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (ids.length === 0) return counts;
    const { data, error } = await supabase.rpc('fn_guest_public_review_counts', {
        p_restaurant_ids: ids,
    });
    if (error) throw error;
    for (const row of (data ?? []) as { restaurant_id: string; review_count: number }[]) {
        counts.set(row.restaurant_id, row.review_count ?? 0);
    }
    return counts;
}

// deno-lint-ignore no-explicit-any
async function loadGuestReviews(supabase: any, restaurantId: string, limit: number, cursor: { sort_date: string; id: string } | null) {
    const { data, error } = await supabase.rpc('get_public_reviews_page_guest', {
        p_restaurant_id: restaurantId,
        p_limit: limit,
        p_cursor_date: cursor?.sort_date ?? null,
        p_cursor_id: cursor?.id ?? null,
    });
    if (error) throw error;
    // deno-lint-ignore no-explicit-any
    const raw = (data ?? []) as any[];
    // Photo enrichment only for ids the eligibility RPC returned.
    const photosByEntry = await loadReviewPhotos(supabase, raw.map((row) => row.entry_id));
    return raw.map((row) => ({
        entry_id: row.entry_id,
        user_id: row.user_id,
        display_name: row.display_name ?? 'User',
        username: row.username ?? null,
        avatar_url: row.avatar_url ?? null,
        rating: row.rating,
        note_excerpt: row.content ?? '',
        photo_url: row.photo_url ?? null,
        photo_urls: photosByEntry.get(row.entry_id) ?? (row.photo_url ? [row.photo_url] : []),
        created_at: row.created_at,
        public_reaction_count: row.public_reaction_count ?? 0,
        public_reply_count: row.public_reply_count ?? 0,
        // Ring-2 calibration and followee flags are viewer-relative; a guest has neither.
        calibration: null,
        is_followee: false,
    }));
}

// Public lists that contain a restaurant. fn_restaurant_featured_lists with a
// NULL viewer admits only public, non-Table lists owned by public accounts.
// deno-lint-ignore no-explicit-any
async function guestFeaturedLists(supabase: any, restaurantId: string) {
    const { data, error } = await supabase.rpc('fn_restaurant_featured_lists', {
        p_viewer: null,
        p_restaurant_id: restaurantId,
        p_limit: 3,
    });
    if (error) throw error;
    // deno-lint-ignore no-explicit-any
    const raw = (data ?? []) as any[];
    return {
        rows: raw.map((row) => ({
            id: row.id as string,
            title: row.title as string,
            emoji: (row.emoji as string | null) ?? null,
            entry_count: Number(row.entry_count ?? 0),
            owner_display_name: (row.owner_display_name as string | null) ?? null,
            owner_username: (row.owner_username as string | null) ?? null,
        })),
        total: raw.length > 0 ? Number(raw[0].total_count ?? 0) : 0,
    };
}

// ── Handler ──────────────────────────────────────────────────────────────────
serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') {
        return new Response(
            JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST only' } }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' } },
        );
    }

    let action: string | null = null;
    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );
        // deno-lint-ignore no-explicit-any
        const body: any = await req.json().catch(() => ({}));
        const url = new URL(req.url);
        action = (typeof body?.action === 'string' && body.action) || url.searchParams.get('action');
        if (!action) return fail('MISSING_ACTION', 'action is required');

        // ── Guest rate limit: fail-CLOSED (an RPC error denies) ─────────────
        const bucket = await guestBucketId(req.headers);
        const { data: rateRows, error: rateError } = await supabase.rpc(
            'check_and_increment_rate_limit',
            {
                p_user_id: bucket,
                p_bucket_key: 'guest_browse',
                p_max: GUEST_RATE_MAX,
                p_window_seconds: GUEST_RATE_WINDOW_SECONDS,
            },
        );
        const rateRow = rateRows?.[0];
        if (rateError || !rateRow || !rateRow.allowed) {
            if (rateError) console.error('public-browse rate check failed:', rateError);
            return json({
                error: {
                    code: 'RATE_LIMITED',
                    message: 'Too many requests, try again shortly',
                    details: { retry_after_seconds: rateRow?.retry_after_seconds ?? 60 },
                },
            }, 429);
        }

        // ── search ───────────────────────────────────────────────────────────
        if (action === 'search') {
            const q = typeof body?.q === 'string' ? body.q.trim() : '';
            if (q.length < 2) return fail('QUERY_TOO_SHORT', 'q must be at least 2 characters');
            if (q.length > 80) return fail('QUERY_TOO_LONG', 'q must be at most 80 characters');
            const { data, error } = await supabase
                .from('restaurants')
                .select(ROW_COLUMNS)
                .ilike('name', `%${q}%`)
                .eq('verification', 'verified')
                .is('merged_into', null)
                .order('google_rating_count', { ascending: false, nullsFirst: false })
                .limit(SEARCH_LIMIT);
            if (error) throw error;
            // deno-lint-ignore no-explicit-any
            const rows = (data ?? []) as any[];
            const counts = await reviewCounts(supabase, rows.map((r) => r.id));
            return json({ data: { rows: rows.map((r) => toGuestRow(r, counts.get(r.id) ?? 0)) } });
        }

        // ── recent ───────────────────────────────────────────────────────────
        if (action === 'recent') {
            const { data: recent, error: recentErr } = await supabase.rpc(
                'fn_guest_recent_restaurants',
                { p_limit: RECENT_LIMIT },
            );
            if (recentErr) throw recentErr;
            const ordered = (recent ?? []) as { restaurant_id: string; review_count: number }[];
            if (ordered.length === 0) return json({ data: { rows: [] } });
            const { data, error } = await supabase
                .from('restaurants')
                .select(ROW_COLUMNS)
                .in('id', ordered.map((r) => r.restaurant_id))
                .eq('verification', 'verified')
                .is('merged_into', null);
            if (error) throw error;
            // deno-lint-ignore no-explicit-any
            const byId = new Map<string, any>((data ?? []).map((r: any) => [r.id, r]));
            const rows = ordered
                .filter((r) => byId.has(r.restaurant_id))
                .map((r) => toGuestRow(byId.get(r.restaurant_id), r.review_count ?? 0));
            return json({ data: { rows } });
        }

        // ── page / reviews share the id resolution ───────────────────────────
        if (action === 'page' || action === 'reviews') {
            const rawId = typeof body?.restaurant_id === 'string' ? body.restaurant_id.trim() : '';
            if (!rawId) return fail('MISSING_RESTAURANT', 'restaurant_id is required');
            // A uuid or a Google place id (external_id); anything longer is junk.
            const resolvedId = rawId.length <= MAX_RESTAURANT_ID_LENGTH
                ? await resolveRestaurantLookupId(supabase, rawId)
                : null;
            if (!resolvedId) {
                return action === 'reviews'
                    ? json({ data: { rows: [], next_cursor: null, has_more: false } })
                    : fail('NOT_FOUND', 'restaurant not found', 404);
            }

            if (action === 'reviews') {
                const pageSize = Math.min(Math.max(Number(body?.limit) || 30, 1), 50);
                const cursor = decodeCursor(body?.cursor);
                const cards = await loadGuestReviews(supabase, resolvedId, pageSize + 1, cursor);
                const page = buildPage(cards, pageSize, (row) => ({
                    sort_date: row.created_at,
                    id: row.entry_id,
                }));
                return json({ data: page });
            }

            const { data: restaurant, error } = await supabase
                .from('restaurants')
                .select(PAGE_COLUMNS)
                .eq('id', resolvedId)
                .eq('verification', 'verified')
                .maybeSingle();
            if (error) throw error;
            if (!restaurant) return fail('NOT_FOUND', 'restaurant not found', 404);

            const [reviews, counts, featuredLists] = await Promise.all([
                loadGuestReviews(supabase, resolvedId, PAGE_PREVIEW_REVIEWS, null),
                reviewCounts(supabase, [resolvedId]),
                guestFeaturedLists(supabase, resolvedId),
            ]);
            return json({
                data: {
                    // A concatenated select string defeats supabase-js row inference.
                    restaurant: guestSafePhoto(restaurant as unknown as Record<string, unknown>),
                    reviews,
                    reviews_total: counts.get(resolvedId) ?? 0,
                    featured_lists: featuredLists,
                },
            });
        }

        // ── list: one public list, read-only ───────────────────────────────
        if (action === 'list') {
            const listId = typeof body?.list_id === 'string' ? body.list_id.trim() : '';
            if (!UUID_RE.test(listId)) return fail('NOT_FOUND', 'list not found', 404);
            const { data: detail, error } = await supabase.rpc('fn_guest_public_list', {
                p_list_id: listId,
            });
            if (error) throw error;
            // NULL covers private, Table, private-account and missing lists alike,
            // so a guest cannot tell a private list from one that does not exist.
            if (!detail) return fail('NOT_FOUND', 'list not found', 404);
            return json({
                data: {
                    ...(detail as Record<string, unknown>),
                    save_count: Number((detail as { save_count?: unknown }).save_count ?? 0),
                    viewer_has_saved: false,
                    can_save: false,
                },
            });
        }

        return fail('UNKNOWN_ACTION', `unknown action: ${action}`);
    } catch (error) {
        console.error('public-browse error', error);
        reportError(error, { fn: 'public-browse', action: action ?? undefined });
        return json({ error: { code: 'INTERNAL', message: 'Unexpected error' } }, 500);
    }
});
