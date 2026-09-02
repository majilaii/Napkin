/**
 * User Profile Edge Function — TICKET-020
 *
 * One aggregated endpoint for the merged /u/[identifier] profile screen.
 * Replaces the original stub (which had a dead value_profiles join).
 *
 * All actions are POST with body `{ action: "...", ... }`.
 *
 * Read actions:
 *   profile         — full merged profile payload, privacy-gated
 *   check_username  — uniqueness check for a candidate username
 *
 * Write actions:
 *   update_profile         — display_name, bio, avatar_url, home_city (partial update)
 *   update_username        — standalone username update (after first flip)
 *   update_privacy         — account_privacy flip; atomic with username on first public flip
 *   update_reply_permission — allow_public_replies boolean
 *
 * Privacy model:
 *   viewer_target_relationship is computed server-side BEFORE any palate data
 *   is fetched. 'none' returns { error: 'not_found' } with no further DB reads.
 *
 * Identifier resolution:
 *   UUID regex match → look up by user_id
 *   else             → case-insensitive username lookup
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { reportError } from '../_shared/report.ts';
import { computeCalibrations, type Calibration } from '../_shared/calibration.ts';
import { buildPage, decodeCursor, type Page } from '../_shared/pagination.ts';
import { projectRound } from '../_shared/round_projection.ts';
import { projectListSummary, type ListSummary } from './listSummary.ts';
import { hydrateProfileTakes, type QuickTake } from './profileTakes.ts';
import { fetchRecentCompanions } from './recentCompanions.ts';

// ── Constants ──────────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Types ──────────────────────────────────────────────────────────────────

import {
    buildPrivateProfileStub,
    computeRelationship,
    decideTasteAggregateAccess,
    fetchBlockState,
    strangerCanReadPalate,
    type BlockState,
    type ViewerRelationship,
} from './gates.ts';
import {
    computeRatingHistogram,
    computeDimensionAvgs,
    type HistogramBucket,
    type DimensionAvgs,
} from './stats.ts';

type ProfileRow = {
    user_id: string;
    username: string | null;
    display_name: string;
    bio: string | null;
    avatar_url: string | null;
    home_city: string | null;
    account_privacy: 'private' | 'public';
    allow_public_replies: boolean;
};

type Stats = {
    total_logs: number;
    total_restaurants: number;
    average_rating: number | null;
    followers_count: number;
    following_count: number;
    /** TICKET-092: dated logs this calendar year (Letterboxd "This year"). */
    logs_this_year: number;
    /** TICKET-092: entries with real written notes (the Reviews count). */
    reviews_count: number;
    /** TICKET-165: sparse half-star histogram over the rated (gated) entries. */
    rating_histogram: HistogramBucket[];
    /** TICKET-165: per-dimension mean + count (vibe/flavor/service/value). */
    dimension_avgs: DimensionAvgs;
};

/** TICKET-092: one distinct logged restaurant (the profile "Spots" ledger +
 * taste band + dining map). Like RegularSummary without the ≥3-visit bar. */
type SpotSummary = {
    restaurant_id: string;
    name: string;
    city: string | null;
    country: string | null;
    cuisine: string | null;
    price_level: number | null;
    lat: number | null;
    lng: number | null;
    photo_url: string | null;
    visit_count: number;
    avg_rating: number | null;
    last_visited_at: string | null;
};

type RestaurantTile = {
    id: string;
    name: string;
    city: string | null;
    photo_url: string | null;
};

type TablePreview = {
    table_id: string;
    table_name: string;
    avg: number | null;
    visit_count: number;
    last_entry_at: string | null;
    last_entry_restaurant_name: string | null;
    last_entry_rating: number | null;
};

type TopPick = {
    restaurant_id: string;
    name: string;
    city: string | null;
    // TICKET-146: drives the marquee-plate mark (engraving registry). null → monogram.
    cuisine: string | null;
    photo_url: string | null;
    // TICKET-157: gates the Places-hero plate tier client-side (`=== 'places'` + flag).
    photo_source: string | null;
    // TICKET-200: paired Places author credit. Missing/invalid client-side means
    // the Places hero fails closed to the typographic plate.
    places_photo_attribution_html: string | null;
    // TICKET-144 pt2: the owner's chosen hero photo (their OWN entry photo at this
    // restaurant), served regardless of the source entry's visibility BECAUSE
    // choosing it is the explicit publish. ONLY the URL rides on the PUBLIC read —
    // no entry_id, no note, no rating, no visibility echo. null → typographic plate.
    hero_photo_url: string | null;
    // OWNER-ONLY (includePrivate): the photo-row id, so the editor can re-save
    // untouched slots without clobbering their heroes (the RPC is delete+reinsert).
    // Public reads get null — the entry_photo id never leaks to strangers.
    hero_entry_photo_id?: string | null;
    // null when the viewer has no non-private rating for a curated pick.
    max_rating: number | null;
    visit_count: number;
    last_visited_at: string | null;
    // Top-Four glance indicators: did the author like it, did they write a review.
    liked: boolean;
    has_review: boolean;
    // The entry id of the author's review for this pick (most recent with content),
    // so tapping a pick opens the REVIEW; null → fall back to the restaurant page.
    review_entry_id: string | null;
};

type RegularSummary = {
    restaurant_id: string;
    name: string;
    city: string | null;
    photo_url: string | null;
    visit_count: number;
    avg_rating: number | null;
    last_visited_at: string | null;
};

type DiaryRow = {
    entry_id: string;
    restaurant_id: string;
    restaurant_name: string;
    city: string | null;
    photo_url: string | null;
    rating: number | null;
    note: string | null;
    visited_at: string;
    created_at: string;
    // TICKET-044: present only for self-view when the entry is part of a merged round.
    // Public diary NEVER includes round_kind — Tables are private.
    round_kind?: 'merged';
    round_id?: string;
    round_participants?: Array<{
        user_id: string;
        display_name: string;
        avatar_url: string | null;
        rating: number | null;
        notes: string | null;
    }>;
    round_average_rating?: number | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function fail(message: string, status = 400): Response {
    return json({ error: message }, status);
}

function notFound(): Response {
    return json({ error: 'not_found' }, 404);
}

/**
 * Resolve a profile row from an identifier.
 * UUID → lookup by user_id; else → case-insensitive username lookup.
 * Returns null if not found.
 */
async function resolveProfile(
    supabase: any,
    identifier: string,
): Promise<ProfileRow | null> {
    const isUuid = UUID_REGEX.test(identifier);
    const { data, error } = isUuid
        ? await supabase
            .from('profiles')
            .select('user_id, username, display_name, bio, avatar_url, home_city, account_privacy, allow_public_replies')
            .eq('user_id', identifier)
            .maybeSingle()
        : await supabase
            .from('profiles')
            .select('user_id, username, display_name, bio, avatar_url, home_city, account_privacy, allow_public_replies')
            .ilike('username', identifier)
            .maybeSingle();

    if (error) throw error;
    return data ?? null;
}

/**
 * Fetch shared table IDs between caller and target.
 */
async function fetchSharedTableIds(
    supabase: any,
    callerId: string,
    targetId: string,
): Promise<string[]> {
    // Self-join: find tables where BOTH caller and target are members
    const { data: callerMemberships, error } = await supabase
        .from('table_members')
        .select('table_id')
        .eq('member_id', callerId);
    if (error) throw error;

    const callerTableIds = (callerMemberships ?? []).map((m: any) => m.table_id as string);
    if (callerTableIds.length === 0) return [];

    const { data: targetMemberships, error: targetErr } = await supabase
        .from('table_members')
        .select('table_id')
        .eq('member_id', targetId)
        .in('table_id', callerTableIds);
    if (targetErr) throw targetErr;

    return (targetMemberships ?? []).map((m: any) => m.table_id as string);
}

/**
 * Fetch all caller's table IDs (for self view — "Your Tables" section).
 */
async function fetchAllCallerTableIds(
    supabase: any,
    callerId: string,
): Promise<string[]> {
    const { data, error } = await supabase
        .from('table_members')
        .select('table_id')
        .eq('member_id', callerId);
    if (error) throw error;
    return (data ?? []).map((m: any) => m.table_id as string);
}

/**
 * Compute Palate stats for the target user.
 * Deliberately does NOT select table_id — enforces "no Table identity in payload".
 */
async function fetchStats(supabase: any, targetId: string, includePrivate = false): Promise<Stats> {
    // TICKET-092: for SELF the ledger counts everything (private + unrated) —
    // the old rated-public-only count made the founder's own "N meals" lie.
    // Public viewers keep the doctrinal bar: non-private AND rated.
    let entriesQuery = supabase
        .from('entries')
        .select(
            'id, restaurant_id, rating, content, visited_at, created_at, ' +
                'vibe_rating, flavor_rating, service_rating, value_rating',
        )
        .eq('user_id', targetId);
    if (!includePrivate) {
        entriesQuery = entriesQuery.neq('visibility', 'private').not('rating', 'is', null);
    }

    const [{ data: entries, error }, followersRes, followingRes] = await Promise.all([
        entriesQuery,
        supabase
            .from('follows')
            .select('follower_id', { count: 'exact', head: true })
            .eq('following_id', targetId),
        supabase
            .from('follows')
            .select('following_id', { count: 'exact', head: true })
            .eq('follower_id', targetId),
    ]);
    if (error) throw error;
    if (followersRes.error) throw followersRes.error;
    if (followingRes.error) throw followingRes.error;

    const rows = (entries ?? []) as Array<{
        id: string;
        restaurant_id: string | null;
        rating: number | null;
        content: string | null;
        visited_at: string | null;
        created_at: string | null;
        vibe_rating: number | null;
        flavor_rating: number | null;
        service_rating: number | null;
        value_rating: number | null;
    }>;
    const totalLogs = rows.length;
    const uniqueRestaurants = new Set(rows.map((r) => r.restaurant_id).filter(Boolean));
    const totalRestaurants = uniqueRestaurants.size;

    const ratedRows = rows.filter((r) => r.rating != null);
    const averageRating =
        ratedRows.length > 0
            ? ratedRows.reduce((sum, r) => sum + (r.rating as number), 0) / ratedRows.length
            : null;

    // TICKET-165: profile rating histogram + dimension means. Both derive from
    // the already-fetched (gated) rows — zero extra queries. The histogram bins
    // the rated ratings; the dimension means each ride their own non-null set.
    const ratingHistogram = computeRatingHistogram(ratedRows.map((r) => r.rating));
    const dimensionAvgs = computeDimensionAvgs(rows);

    const yearStart = `${new Date().getFullYear()}-01-01`;
    let logsThisYear = 0;
    let reviewsCount = 0;
    for (const r of rows) {
        const visited = (r.visited_at ?? r.created_at ?? '') as string;
        if (visited >= yearStart) logsThisYear++;
        if (typeof r.content === 'string' && r.content.trim().length > 0) reviewsCount++;
    }

    return {
        total_logs: totalLogs,
        total_restaurants: totalRestaurants,
        average_rating: averageRating,
        followers_count: followersRes.count ?? 0,
        following_count: followingRes.count ?? 0,
        logs_this_year: logsThisYear,
        reviews_count: reviewsCount,
        rating_histogram: ratingHistogram,
        dimension_avgs: dimensionAvgs,
    };
}

/**
 * Fetch the target's public lists with entry counts.
 */
async function fetchPublicLists(supabase: any, targetId: string): Promise<ListSummary[]> {
    const { data: lists, error } = await supabase
        .from('lists')
        .select('id, title, ranked, privacy, updated_at')
        .eq('owner_id', targetId)
        .eq('privacy', 'public')
        .order('updated_at', { ascending: false });
    if (error) throw error;

    const enriched: ListSummary[] = [];
    for (const list of (lists ?? []) as any[]) {
        const { count } = await supabase
            .from('list_entries')
            .select('id', { count: 'exact', head: true })
            .eq('list_id', list.id);

        // Cover: first entry's restaurant photo
        const orderCol = list.ranked ? 'position' : 'created_at';
        const { data: firstEntry } = await supabase
            .from('list_entries')
            .select(
                'restaurant:restaurants(name, photo_url, photo_source, places_photo_attribution_html)',
            )
            .eq('list_id', list.id)
            .order(orderCol, { ascending: !!list.ranked })
            .limit(1)
            .maybeSingle();

        enriched.push(projectListSummary(
            list,
            count ?? 0,
            firstEntry?.restaurant as any,
        ));
    }
    return enriched;
}

/**
 * Fetch recently-logged restaurant tiles (deduped by restaurant_id, up to 12).
 * Query up to 200 entries, then JS-side reduce to 12 unique restaurants.
 */
async function fetchRecentlyLogged(supabase: any, targetId: string): Promise<RestaurantTile[]> {
    const { data: entries, error } = await supabase
        .from('entries')
        .select('restaurant_id, visited_at, created_at')
        .eq('user_id', targetId)
        .neq('visibility', 'private')
        .not('restaurant_id', 'is', null)
        .not('rating', 'is', null)
        .order('visited_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);
    if (error) throw error;

    // Deduplicate — keep first occurrence (most recent) per restaurant_id
    const seen = new Set<string>();
    const restaurantIds: string[] = [];
    for (const e of (entries ?? []) as any[]) {
        const rid = e.restaurant_id as string;
        if (!seen.has(rid)) {
            seen.add(rid);
            restaurantIds.push(rid);
        }
        if (restaurantIds.length >= 12) break;
    }

    if (restaurantIds.length === 0) return [];

    const { data: restaurants, error: restErr } = await supabase
        .from('restaurants')
        .select('id, name, city, photo_url')
        .in('id', restaurantIds);
    if (restErr) throw restErr;

    // Return in insertion order (most-recent first)
    const byId = new Map((restaurants ?? []).map((r: any) => [r.id as string, r]));
    return restaurantIds
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((r: any): RestaurantTile => ({
            id: r.id,
            name: r.name,
            city: r.city ?? null,
            photo_url: r.photo_url ?? null,
        }));
}

/**
 * Fetch preview cards for a list of table IDs, showing the target user's
 * activity at each table. Used for both "Tables in common" (target's stats
 * at the shared tables) and "Your Tables" (self view — own stats).
 */
async function fetchTablePreviews(
    supabase: any,
    subjectId: string,
    tableIds: string[],
    callerContext: 'self' | 'other',
): Promise<TablePreview[]> {
    if (tableIds.length === 0) return [];

    // Fetch table names
    const { data: tables, error: tableErr } = await supabase
        .from('tables')
        .select('id, name')
        .in('id', tableIds);
    if (tableErr) throw tableErr;

    const tableNameMap = new Map<string, string>((tables ?? []).map((t: any) => [t.id as string, t.name as string]));

    const previews: TablePreview[] = [];

    for (const tableId of tableIds) {
        // Fetch all non-private entries by subject in this table for stats
        const { data: entryRows, error: entryErr } = await supabase
            .from('entries')
            .select('id, rating, visited_at, created_at, restaurant_id, restaurants(name)')
            .eq('user_id', subjectId)
            .eq('table_id', tableId)
            .neq('visibility', 'private')
            .not('rating', 'is', null)
            .order('visited_at', { ascending: false })
            .order('created_at', { ascending: false });
        if (entryErr) throw entryErr;

        const rows = (entryRows ?? []) as Array<{
            id: string;
            rating: number | null;
            visited_at: string | null;
            created_at: string;
            restaurant_id: string | null;
            restaurants: { name: string } | null;
        }>;

        const ratedRows = rows.filter((r) => r.rating != null);
        const avg =
            ratedRows.length > 0
                ? ratedRows.reduce((sum, r) => sum + (r.rating as number), 0) / ratedRows.length
                : null;

        const mostRecent = rows[0] ?? null;
        const lastRestaurant = mostRecent?.restaurants;
        const lastRestaurantName = Array.isArray(lastRestaurant)
            ? lastRestaurant[0]?.name ?? null
            : lastRestaurant?.name ?? null;

        previews.push({
            table_id: tableId,
            table_name: tableNameMap.get(tableId) || 'Table',
            avg,
            visit_count: ratedRows.length,
            last_entry_at: mostRecent ? (mostRecent.visited_at ?? mostRecent.created_at) : null,
            last_entry_restaurant_name: lastRestaurantName,
            last_entry_rating: mostRecent?.rating ?? null,
        });
    }

    // Sort: non-self → by last_entry_at DESC; self → same
    previews.sort((a, b) => {
        if (!a.last_entry_at && !b.last_entry_at) return 0;
        if (!a.last_entry_at) return 1;
        if (!b.last_entry_at) return -1;
        return a.last_entry_at < b.last_entry_at ? 1 : -1;
    });

    return previews;
}

/**
 * Fetch Top 4 — auto-derived: rating >= 4.0, grouped by restaurant,
 * ordered by max rating / visit_count / last_visited.
 */
// Build TopPick[] for a fixed, ordered set of restaurant ids (the manual
// profile Top 4 override). Aggregates the user's own ratings for each pick.
async function buildPicksFromIds(
    supabase: any,
    userId: string,
    orderedIds: string[],
    includePrivate: boolean,
    // TICKET-144 pt2: restaurant_id → chosen hero_entry_photo_id (curated only).
    heroByRestaurant?: Map<string, string>,
): Promise<TopPick[]> {
    if (orderedIds.length === 0) return [];

    // Curated MEMBERSHIP is public, but the rating NUMBER must still respect
    // per-entry visibility — a public viewer must not see a private rating.
    let entriesQuery = supabase
        .from('entries')
        .select('id, restaurant_id, rating, visited_at, created_at, liked, content')
        .eq('user_id', userId)
        .in('restaurant_id', orderedIds);
    if (!includePrivate) entriesQuery = entriesQuery.neq('visibility', 'private');
    const { data: entries, error } = await entriesQuery;
    if (error) throw error;

    // liked / has_review fold across ALL the author's entries for the pick (not just
    // rated ones) — a curated pick may be liked or reviewed without a number.
    // review_entry_id = id of the most-recent entry that has written content.
    const agg = new Map<string, { max_rating: number | null; visit_count: number; last_visited_at: string | null; liked: boolean; has_review: boolean; review_entry_id: string | null; review_at: string | null }>();
    for (const e of (entries ?? []) as any[]) {
        const rid = e.restaurant_id as string;
        const rating = e.rating != null ? Number(e.rating) : null;
        const visited = (e.visited_at ?? e.created_at) as string;
        const liked = e.liked === true;
        const hasReview = typeof e.content === 'string' && e.content.trim().length > 0;
        const ex = agg.get(rid);
        if (!ex) {
            agg.set(rid, {
                max_rating: rating, visit_count: 1, last_visited_at: visited, liked, has_review: hasReview,
                review_entry_id: hasReview ? e.id : null,
                review_at: hasReview ? visited : null,
            });
        } else {
            if (rating != null) ex.max_rating = ex.max_rating != null ? Math.max(ex.max_rating, rating) : rating;
            ex.visit_count += 1;
            if (!ex.last_visited_at || visited > ex.last_visited_at) ex.last_visited_at = visited;
            ex.liked = ex.liked || liked;
            ex.has_review = ex.has_review || hasReview;
            if (hasReview && (!ex.review_at || visited > ex.review_at)) {
                ex.review_entry_id = e.id;
                ex.review_at = visited;
            }
        }
    }

    const { data: rests, error: restErr } = await supabase
        .from('restaurants')
        .select('id, name, city, cuisine, photo_url, photo_source, places_photo_attribution_html')
        .in('id', orderedIds);
    if (restErr) throw restErr;

    // TICKET-144 pt2: hydrate chosen-memory hero URLs. Service-role read of
    // entry_photos by id — RLS-bypassing BY DESIGN: choosing the photo is the
    // publish, so the hero is servable on a public profile even when the source
    // entry is private. We fetch ONLY the URL; `includePrivate` is deliberately
    // NOT applied here — that IS the consent bypass. Nothing else from the entry
    // (id, note, rating, visibility) rides along.
    const heroUrlById = new Map<string, string>();
    const heroIds = heroByRestaurant ? [...heroByRestaurant.values()].filter(Boolean) : [];
    if (heroIds.length) {
        const { data: heroRows } = await supabase
            .from('entry_photos')
            .select('id, photo_url')
            .in('id', heroIds);
        for (const r of (heroRows ?? []) as any[]) if (r.photo_url) heroUrlById.set(r.id, r.photo_url);
    }

    const byId = new Map<string, any>((rests ?? []).map((r: any) => [r.id, r]));
    return orderedIds
        .map((rid): TopPick | null => {
            const rest = byId.get(rid);
            if (!rest) return null;
            const a = agg.get(rid);
            return {
                restaurant_id: rid,
                name: rest.name,
                city: rest.city ?? null,
                cuisine: rest.cuisine ?? null,
                photo_url: rest.photo_url ?? null,
                photo_source: rest.photo_source ?? null,
                places_photo_attribution_html: rest.places_photo_attribution_html ?? null,
                hero_photo_url: heroByRestaurant
                    ? (heroUrlById.get(heroByRestaurant.get(rid) ?? '') ?? null)
                    : null,
                // Owner-only: the id (for lossless re-save). Public → null.
                hero_entry_photo_id: includePrivate ? (heroByRestaurant?.get(rid) ?? null) : null,
                max_rating: a ? a.max_rating : null,
                visit_count: a ? a.visit_count : 0,
                last_visited_at: a ? a.last_visited_at : null,
                liked: a ? a.liked : false,
                has_review: a ? a.has_review : false,
                review_entry_id: a ? a.review_entry_id : null,
            };
        })
        .filter((p): p is TopPick => p !== null);
}

async function fetchTopFour(
    supabase: any,
    userId: string,
    includePrivate: boolean,
): Promise<TopPick[]> {
    // Manual override: a hand-curated profile Top 4 takes precedence over the
    // auto-derived list. Curated picks are a public-expression surface (like a
    // list) — shown to anyone who can see the profile, rating included.
    const { data: manual, error: manualErr } = await supabase
        .from('user_profile_top_4')
        .select('position, restaurant_id, hero_entry_photo_id')
        .eq('user_id', userId)
        .order('position', { ascending: true });
    if (manualErr) throw manualErr;
    if (manual && manual.length > 0) {
        // TICKET-144 pt2: only manual/curated picks carry hero photos.
        const heroByRestaurant = new Map<string, string>();
        for (const m of manual as any[]) {
            if (m.hero_entry_photo_id) heroByRestaurant.set(m.restaurant_id, m.hero_entry_photo_id);
        }
        return await buildPicksFromIds(
            supabase,
            userId,
            manual.map((m: any) => m.restaurant_id),
            includePrivate,
            heroByRestaurant,
        );
    }

    let query = supabase
        .from('entries')
        .select('id, restaurant_id, rating, visited_at, created_at, liked, content')
        .eq('user_id', userId)
        .not('restaurant_id', 'is', null)
        .not('rating', 'is', null)
        .gte('rating', 4.0);

    if (!includePrivate) query = query.neq('visibility', 'private');

    const { data: entries, error } = await query;
    if (error) throw error;

    type Bucket = {
        restaurant_id: string;
        max_rating: number;
        visit_count: number;
        last_visited_at: string | null;
        liked: boolean;
        has_review: boolean;
        review_entry_id: string | null;
        review_at: string | null;
    };

    const buckets = new Map<string, Bucket>();
    for (const e of (entries ?? []) as any[]) {
        const rid = e.restaurant_id as string;
        const rating = Number(e.rating);
        const visited = (e.visited_at ?? e.created_at) as string;
        const liked = e.liked === true;
        const hasReview = typeof e.content === 'string' && e.content.trim().length > 0;
        const existing = buckets.get(rid);
        if (!existing) {
            buckets.set(rid, {
                restaurant_id: rid,
                max_rating: rating,
                visit_count: 1,
                last_visited_at: visited,
                liked,
                has_review: hasReview,
                review_entry_id: hasReview ? e.id : null,
                review_at: hasReview ? visited : null,
            });
        } else {
            existing.max_rating = Math.max(existing.max_rating, rating);
            existing.visit_count += 1;
            if (!existing.last_visited_at || visited > existing.last_visited_at) {
                existing.last_visited_at = visited;
            }
            existing.liked = existing.liked || liked;
            existing.has_review = existing.has_review || hasReview;
            if (hasReview && (!existing.review_at || visited > existing.review_at)) {
                existing.review_entry_id = e.id;
                existing.review_at = visited;
            }
        }
    }

    const ranked = Array.from(buckets.values())
        .sort((a, b) => {
            if (a.max_rating !== b.max_rating) return b.max_rating - a.max_rating;
            if (a.visit_count !== b.visit_count) return b.visit_count - a.visit_count;
            const al = a.last_visited_at ?? '';
            const bl = b.last_visited_at ?? '';
            return al < bl ? 1 : al > bl ? -1 : 0;
        })
        .slice(0, 4);

    if (ranked.length === 0) return [];

    const { data: rests, error: restErr } = await supabase
        .from('restaurants')
        .select('id, name, city, cuisine, photo_url, photo_source, places_photo_attribution_html')
        .in('id', ranked.map((r) => r.restaurant_id));
    if (restErr) throw restErr;

    const byId = new Map<string, any>((rests ?? []).map((r: any) => [r.id, r]));
    return ranked
        .map((r): TopPick | null => {
            const rest = byId.get(r.restaurant_id);
            if (!rest) return null;
            return {
                restaurant_id: r.restaurant_id,
                name: rest.name,
                city: rest.city ?? null,
                cuisine: rest.cuisine ?? null,
                photo_url: rest.photo_url ?? null,
                photo_source: rest.photo_source ?? null,
                places_photo_attribution_html: rest.places_photo_attribution_html ?? null,
                // Heroes are a curated-only feature; auto-derived picks never carry one.
                hero_photo_url: null,
                hero_entry_photo_id: null,
                max_rating: r.max_rating,
                visit_count: r.visit_count,
                last_visited_at: r.last_visited_at,
                liked: r.liked,
                has_review: r.has_review,
                review_entry_id: r.review_entry_id,
            };
        })
        .filter((x): x is TopPick => x !== null);
}

/**
 * Fetch the target's authored Quick takes. This intentionally reads only the
 * dedicated profile table plus the restaurant identity/public Places-photo
 * columns. It never touches entries, ratings, entry_photos, saves, or Tables.
 */
async function fetchQuickTakes(supabase: any, userId: string): Promise<QuickTake[]> {
    const { data: takes, error: takesError } = await supabase
        .from('user_profile_takes')
        .select('prompt_key, position, restaurant_id, note')
        .eq('user_id', userId)
        .order('position', { ascending: true });
    if (takesError) throw takesError;
    if (!takes || takes.length === 0) return [];

    const restaurantIds = [...new Set(
        (takes as Array<{ restaurant_id: string }>).map((take) => take.restaurant_id),
    )];
    const { data: restaurants, error: restaurantsError } = await supabase
        .from('restaurants')
        .select('id, name, city, cuisine, photo_url, photo_source, places_photo_attribution_html')
        .in('id', restaurantIds);
    if (restaurantsError) throw restaurantsError;

    return hydrateProfileTakes(takes as any[], (restaurants ?? []) as any[]);
}

/**
 * Fetch regulars — restaurants with >= 3 logged visits.
 */
async function fetchRegulars(
    supabase: any,
    userId: string,
    includePrivate: boolean,
    limit: number = 8,
): Promise<RegularSummary[]> {
    let query = supabase
        .from('entries')
        .select('restaurant_id, rating, visited_at, created_at')
        .eq('user_id', userId)
        .not('restaurant_id', 'is', null);

    if (!includePrivate) query = query.neq('visibility', 'private');

    const { data: entries, error } = await query;
    if (error) throw error;

    type Bucket = {
        restaurant_id: string;
        visit_count: number;
        rating_sum: number;
        rating_count: number;
        last_visited_at: string | null;
    };

    const buckets = new Map<string, Bucket>();
    for (const e of (entries ?? []) as any[]) {
        const rid = e.restaurant_id as string;
        const rating = e.rating != null ? Number(e.rating) : null;
        const visited = (e.visited_at ?? e.created_at) as string;
        const existing = buckets.get(rid);
        if (!existing) {
            buckets.set(rid, {
                restaurant_id: rid,
                visit_count: 1,
                rating_sum: rating ?? 0,
                rating_count: rating != null ? 1 : 0,
                last_visited_at: visited,
            });
        } else {
            existing.visit_count += 1;
            if (rating != null) {
                existing.rating_sum += rating;
                existing.rating_count += 1;
            }
            if (!existing.last_visited_at || visited > existing.last_visited_at) {
                existing.last_visited_at = visited;
            }
        }
    }

    const eligible = Array.from(buckets.values())
        .filter((b) => b.visit_count >= 3)
        .sort((a, b) => {
            if (a.visit_count !== b.visit_count) return b.visit_count - a.visit_count;
            const al = a.last_visited_at ?? '';
            const bl = b.last_visited_at ?? '';
            return al < bl ? 1 : al > bl ? -1 : 0;
        })
        .slice(0, limit);

    if (eligible.length === 0) return [];

    const regularRestaurantIds = eligible.map((r) => r.restaurant_id);

    // Restaurant name/city only — NEVER restaurants.photo_url (Google Places
    // photo). Founder doctrine (TICKET-105, 2026-07-05): Napkin shows no
    // restaurant photos right now. A regular's thumb may only be a photo the
    // profile owner uploaded on one of their OWN entries at that restaurant.
    const { data: rests, error: restErr } = await supabase
        .from('restaurants')
        .select('id, name, city')
        .in('id', regularRestaurantIds);
    if (restErr) throw restErr;

    // Batch-fetch the profile owner's own entry photos at these restaurants —
    // ONE query, newest first, then keep the first (most recent) photo per
    // restaurant. Same visibility gate as the entries aggregation above: for a
    // non-self viewer, private entries are excluded (`includePrivate === false`
    // ⇒ visibility != 'private'), which mirrors the public diary/reviews gate.
    // Self may surface photos from any of their own entries.
    const photoByRestaurant = new Map<string, string>();
    let photoQuery = supabase
        .from('entry_photos')
        .select('photo_url, created_at, entries!inner(user_id, restaurant_id, visibility)')
        .eq('entries.user_id', userId)
        .in('entries.restaurant_id', regularRestaurantIds)
        .not('photo_url', 'is', null)
        .order('created_at', { ascending: false });
    if (!includePrivate) photoQuery = photoQuery.neq('entries.visibility', 'private');

    const { data: photoRows, error: photoErr } = await photoQuery;
    if (photoErr) throw photoErr;

    // Rows are newest-first; the first one seen per restaurant is the most recent.
    for (const p of (photoRows ?? []) as any[]) {
        const rid = p.entries?.restaurant_id as string | undefined;
        const url = p.photo_url as string | null;
        if (!rid || !url) continue;
        if (!photoByRestaurant.has(rid)) photoByRestaurant.set(rid, url);
    }

    const byId = new Map<string, any>((rests ?? []).map((r: any) => [r.id, r]));
    return eligible
        .map((r): RegularSummary | null => {
            const rest = byId.get(r.restaurant_id);
            if (!rest) return null;
            return {
                restaurant_id: r.restaurant_id,
                name: rest.name,
                city: rest.city ?? null,
                photo_url: photoByRestaurant.get(r.restaurant_id) ?? null,
                visit_count: r.visit_count,
                avg_rating: r.rating_count > 0 ? r.rating_sum / r.rating_count : null,
                last_visited_at: r.last_visited_at,
            };
        })
        .filter((x): x is RegularSummary => x !== null);
}

/**
 * TICKET-092: every distinct restaurant the user has logged — the profile
 * "Spots" ledger (Letterboxd Films), the taste band's raw material, and the
 * dining map's pins. Same aggregation as fetchRegulars minus the ≥3-visit bar,
 * with the restaurant select widened to geo/taste fields.
 */
async function fetchSpots(
    supabase: any,
    userId: string,
    includePrivate: boolean,
    limit: number = 500,
): Promise<SpotSummary[]> {
    let query = supabase
        .from('entries')
        .select('restaurant_id, rating, visited_at, created_at')
        .eq('user_id', userId)
        .not('restaurant_id', 'is', null);

    if (!includePrivate) query = query.neq('visibility', 'private');

    const { data: entries, error } = await query;
    if (error) throw error;

    type Bucket = {
        restaurant_id: string;
        visit_count: number;
        rating_sum: number;
        rating_count: number;
        last_visited_at: string | null;
    };

    const buckets = new Map<string, Bucket>();
    for (const e of (entries ?? []) as any[]) {
        const rid = e.restaurant_id as string;
        const rating = e.rating != null ? Number(e.rating) : null;
        const visited = (e.visited_at ?? e.created_at) as string;
        const existing = buckets.get(rid);
        if (!existing) {
            buckets.set(rid, {
                restaurant_id: rid,
                visit_count: 1,
                rating_sum: rating ?? 0,
                rating_count: rating != null ? 1 : 0,
                last_visited_at: visited,
            });
        } else {
            existing.visit_count += 1;
            if (rating != null) {
                existing.rating_sum += rating;
                existing.rating_count += 1;
            }
            if (!existing.last_visited_at || visited > existing.last_visited_at) {
                existing.last_visited_at = visited;
            }
        }
    }

    const ordered = Array.from(buckets.values())
        .sort((a, b) => {
            const al = a.last_visited_at ?? '';
            const bl = b.last_visited_at ?? '';
            return al < bl ? 1 : al > bl ? -1 : 0;
        })
        .slice(0, limit);

    if (ordered.length === 0) return [];

    const { data: rests, error: restErr } = await supabase
        .from('restaurants')
        .select('id, name, city, country, cuisine, price_level, lat, lng, photo_url')
        .in('id', ordered.map((r) => r.restaurant_id));
    if (restErr) throw restErr;

    const byId = new Map<string, any>((rests ?? []).map((r: any) => [r.id, r]));
    return ordered
        .map((r): SpotSummary | null => {
            const rest = byId.get(r.restaurant_id);
            if (!rest) return null;
            return {
                restaurant_id: r.restaurant_id,
                name: rest.name,
                city: rest.city ?? null,
                country: rest.country ?? null,
                cuisine: rest.cuisine ?? null,
                price_level: rest.price_level ?? null,
                lat: rest.lat ?? null,
                lng: rest.lng ?? null,
                photo_url: rest.photo_url ?? null,
                visit_count: r.visit_count,
                avg_rating: r.rating_count > 0 ? r.rating_sum / r.rating_count : null,
                last_visited_at: r.last_visited_at,
            };
        })
        .filter((x): x is SpotSummary => x !== null);
}

/**
 * Fetch diary rows for a user — chronological, paginated via visited_at cursor.
 *
 * TICKET-044: When includeRoundData=true (self-view), entries that are part of
 * a merged round get hydrated with round_kind, round_id, round_participants, and
 * round_average_rating. This is a private/self-only surface — Tables are never public.
 *
 * When includeRoundData=false (public viewer), the diary always returns the solo
 * entry view — never the merged-round payload. This enforces the privacy boundary:
 * "Tables are never public; even on public profiles, the Table layer stays sacred."
 */
async function fetchDiary(
    supabase: any,
    userId: string,
    includePrivate: boolean,
    cursor: string | null,
    limit: number = 30,
    includeRoundData: boolean = false,
    reviewsOnly: boolean = false,
): Promise<Page<DiaryRow>> {
    const decoded = decodeCursor(cursor);

    // TICKET-099: keyset pagination lives in SQL on a projected
    // sort_date = COALESCE(visited_at, created_at) — `entries` has no sort_date
    // column, so filtering it via PostgREST 42703'd every page-2+ request.
    // Same pattern as fn_friends_feed / fn_user_aggregate_feed. The reviews
    // surface (TICKET-092) shares the ordering, so the cursor stays valid.
    const { data: entries, error } = await supabase.rpc('fn_user_diary_page', {
        p_user_id: userId,
        p_include_private: includePrivate,
        p_reviews_only: reviewsOnly,
        p_cursor_date: decoded?.sort_date ?? null,
        p_cursor_id: decoded?.id ?? null,
        p_limit: limit + 1,
    });
    if (error) throw error;

    // Page the RAW limit+1 rows first so the has_more probe row is never
    // hydrated, and the cursor date is the exact sort_date the SQL ordered by.
    const page = buildPage((entries ?? []) as any[], limit, (r) => ({
        sort_date: r.sort_date,
        id: r.id,
    }));

    const mapped: DiaryRow[] = await Promise.all(page.rows.map(async (e) => {
        const base: DiaryRow = {
            entry_id: e.id,
            restaurant_id: e.restaurant_id,
            restaurant_name: e.restaurant_name ?? 'Unknown',
            city: e.restaurant_city ?? null,
            photo_url: e.photo_url ?? e.restaurant_photo_url ?? null,
            rating: e.rating,
            note: e.content ?? null,
            visited_at: e.visited_at ?? e.created_at,
            created_at: e.created_at,
        };

        // TICKET-044: hydrate merged-round data for self-view only.
        // Public diary never includes this — privacy boundary enforced here AND in the
        // calling site (includeRoundData = isSelf only).
        if (includeRoundData) {
            const { data: binding } = await supabase
                .from('round_entries')
                .select('round_id')
                .eq('entry_id', e.id)
                .maybeSingle();

            if (binding?.round_id) {
                const { participants, average_rating } = await projectRound(
                    binding.round_id,
                    'merged',
                    supabase,
                );
                return {
                    ...base,
                    round_kind: 'merged' as const,
                    round_id: binding.round_id,
                    round_participants: participants,
                    round_average_rating: average_rating,
                };
            }
        }

        return base;
    }));

    return { rows: mapped, next_cursor: page.next_cursor, has_more: page.has_more };
}

// ── Main ───────────────────────────────────────────────────────────────────

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return fail('Missing Authorization header', 401);

        const token = authHeader.replace('Bearer ', '');
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        // Service-role client — bypasses RLS; auth validated manually
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) return fail('Unauthorized', 401);

        if (req.method !== 'POST') return fail('Method not allowed', 405);

        const body = await req.json();
        const { action } = body;

        // ── profile (read) ────────────────────────────────────────────────
        if (action === 'profile') {
            const { identifier } = body;
            if (!identifier || typeof identifier !== 'string') {
                return fail('identifier is required', 400);
            }

            // 1. Resolve target profile
            const targetProfile = await resolveProfile(supabase, identifier);

            // If target doesn't exist, always return not_found (no existence leak)
            if (!targetProfile) return notFound();

            const callerId = user.id;
            const targetId = targetProfile.user_id;
            const isSelf = callerId === targetId;

            if (isSelf) {
                // Self: return everything, even if private
                const [stats, publicLists, recentlyLogged, topFour, quickTakes, regularsPreview, allTableIds] =
                    await Promise.all([
                        fetchStats(supabase, targetId, true), // self: full ledger incl. private/unrated
                        fetchPublicLists(supabase, targetId),
                        fetchRecentlyLogged(supabase, targetId),
                        fetchTopFour(supabase, targetId, true),
                        fetchQuickTakes(supabase, targetId),
                        fetchRegulars(supabase, targetId, true, 8),
                        fetchAllCallerTableIds(supabase, callerId),
                    ]);

                const tablePreviews = await fetchTablePreviews(supabase, targetId, allTableIds, 'self');

                return json({
                    data: {
                        profile: targetProfile,
                        stats,
                        public_lists: publicLists,
                        recently_logged: recentlyLogged,
                        tables_in_common: tablePreviews,
                        top_four: topFour,
                        quick_takes: quickTakes,
                        regulars_preview: regularsPreview,
                        is_self: true,
                        is_following_viewer: false, // self never follows self
                        follows_viewer: false, // self never follows self
                        viewer_target_relationship: 'self' as ViewerRelationship,
                    },
                });
            }

            // home_city is returned to the owner for settings, but it is not
            // part of the public/private profile identity contract.
            const profileIdentity = {
                user_id: targetProfile.user_id,
                username: targetProfile.username,
                display_name: targetProfile.display_name,
                bio: targetProfile.bio,
                avatar_url: targetProfile.avatar_url,
                account_privacy: targetProfile.account_privacy,
                allow_public_replies: targetProfile.allow_public_replies,
            };

            // 1b. Blocks trump everything (TICKET-090). Target-blocked-viewer
            // reads as not-found (no existence signal); viewer-blocked-target
            // returns a minimal stub so the client can offer "unblock".
            const blockState = await fetchBlockState(supabase, callerId, targetId);
            if (blockState === 'target_blocked_viewer') return notFound();
            if (blockState === 'viewer_blocked_target') {
                return json({
                    data: {
                        profile: profileIdentity,
                        stats: null,
                        public_lists: null,
                        recently_logged: null,
                        tables_in_common: [],
                        top_four: [],
                        quick_takes: [],
                        regulars_preview: [],
                        is_self: false,
                        is_following_viewer: false,
                        follows_viewer: false,
                        viewer_target_relationship: 'none' as ViewerRelationship,
                        blocked_by_viewer: true,
                    },
                });
            }

            // 2. Compute relationship BEFORE any palate DB reads
            const sharedTableIds = await fetchSharedTableIds(supabase, callerId, targetId);
            const relationship = computeRelationship(callerId, targetProfile.account_privacy, sharedTableIds);

            // 3. 'none' → TICKET-155: an EXISTING private target with no shared
            //    Table is now REACHABLE — return an identity stub instead of a
            //    404 so a viewer can confirm who they're following and follow
            //    immediately (no request/approve). The target DOES exist here
            //    (the !targetProfile guard above already 404'd genuine
            //    nonexistence, so existence-ambiguity for real 404s is intact),
            //    is not self, is not blocked either way (both handled above),
            //    and is private with no overlap. Social counts (follower/
            //    following) are metadata, not palate — same precedent as the
            //    tables_in_common branch — so we run the two count(*) queries +
            //    the two follow-direction reads here and withhold ALL palate.
            if (relationship === 'none') {
                const [followRowRes, followsViewerRowRes, followersRes, followingRes] =
                    await Promise.all([
                        supabase
                            .from('follows')
                            .select('follower_id')
                            .eq('follower_id', callerId)
                            .eq('following_id', targetId)
                            .maybeSingle(),
                        supabase
                            .from('follows')
                            .select('follower_id')
                            .eq('follower_id', targetId)
                            .eq('following_id', callerId)
                            .maybeSingle(),
                        supabase
                            .from('follows')
                            .select('follower_id', { count: 'exact', head: true })
                            .eq('following_id', targetId),
                        supabase
                            .from('follows')
                            .select('following_id', { count: 'exact', head: true })
                            .eq('follower_id', targetId),
                    ]);
                return json({
                    data: buildPrivateProfileStub(profileIdentity, {
                        isFollowingViewer: followRowRes.data !== null,
                        followsViewer: followsViewerRowRes.data !== null,
                        followersCount: followersRes.count ?? 0,
                        followingCount: followingRes.count ?? 0,
                    }),
                });
            }

            // 4. Resolve both follow directions in one round-trip:
            //    isFollowingViewer = caller → target (viewer follows this profile)
            //    followsViewer     = target → caller (this profile follows viewer back)
            const [followRowRes, followsViewerRowRes] = await Promise.all([
                supabase
                    .from('follows')
                    .select('follower_id')
                    .eq('follower_id', callerId)
                    .eq('following_id', targetId)
                    .maybeSingle(),
                supabase
                    .from('follows')
                    .select('follower_id')
                    .eq('follower_id', targetId)
                    .eq('following_id', callerId)
                    .maybeSingle(),
            ]);
            const isFollowingViewer = followRowRes.data !== null;
            const followsViewer = followsViewerRowRes.data !== null;

            // 5. 'tables_in_common' only — no palate access. Follower/following
            //    counts ARE social metadata, not palate, so a private tablemate's
            //    real counts surface here. Run ONLY the two count(*) queries — never
            //    the full stats fetch — so no logs/avg/review data leaks.
            if (relationship === 'tables_in_common') {
                const [tablePreviews, followersRes, followingRes] = await Promise.all([
                    fetchTablePreviews(supabase, targetId, sharedTableIds, 'other'),
                    supabase
                        .from('follows')
                        .select('follower_id', { count: 'exact', head: true })
                        .eq('following_id', targetId),
                    supabase
                        .from('follows')
                        .select('following_id', { count: 'exact', head: true })
                        .eq('follower_id', targetId),
                ]);
                return json({
                    data: {
                        profile: profileIdentity,
                        // stats stays null (palate withheld); social counts ride
                        // a sibling field so the client can distinguish
                        // "counts present, palate withheld" from "palate present".
                        stats: null,
                        social: {
                            followers_count: followersRes.count ?? 0,
                            following_count: followingRes.count ?? 0,
                        },
                        public_lists: null,
                        recently_logged: null,
                        tables_in_common: tablePreviews,
                        top_four: [],
                        quick_takes: [],
                        regulars_preview: [],
                        is_self: false,
                        is_following_viewer: isFollowingViewer,
                        follows_viewer: followsViewer,
                        viewer_target_relationship: relationship,
                    },
                });
            }

            // 6. public_only or public_and_tables — fetch palate
            const [stats, publicLists, recentlyLogged, topFour, quickTakes, regularsPreview] = await Promise.all([
                fetchStats(supabase, targetId),
                fetchPublicLists(supabase, targetId),
                fetchRecentlyLogged(supabase, targetId),
                fetchTopFour(supabase, targetId, false),
                fetchQuickTakes(supabase, targetId),
                fetchRegulars(supabase, targetId, false, 8),
            ]);

            let tablePreviews: TablePreview[] = [];
            if (relationship === 'public_and_tables') {
                tablePreviews = await fetchTablePreviews(supabase, targetId, sharedTableIds, 'other');
            }

            // 7. Calibration — only for public_only relationship (not public_and_tables,
            //    which indicates Ring 1 applies; not self; not tables_in_common).
            //    Attach the viewer's own rated-entry count so the client can decide
            //    whether to show the chip or the "rate more" prompt.
            let calibration: Calibration | null = null;
            let viewerRatedEntryCount = 0;

            if (relationship === 'public_only') {
                // Fetch viewer's own rated-entry count (all privacy levels — calibration
                // is a viewer-side utility; privacy controls what they share, not consume).
                const { count: ratedCount } = await supabase
                    .from('entries')
                    .select('id', { count: 'exact', head: true })
                    .eq('user_id', callerId)
                    .not('rating', 'is', null)
                    .not('restaurant_id', 'is', null);
                viewerRatedEntryCount = ratedCount ?? 0;

                // Compute calibration (tablemate check is inside the helper as defense-in-depth)
                const calMap = await computeCalibrations(supabase, callerId, [targetId]);
                calibration = calMap.get(targetId) ?? null;
            }

            return json({
                data: {
                    profile: profileIdentity,
                    stats,
                    public_lists: publicLists,
                    recently_logged: recentlyLogged,
                    tables_in_common: tablePreviews,
                    top_four: topFour,
                    quick_takes: quickTakes,
                    regulars_preview: regularsPreview,
                    is_self: false,
                    is_following_viewer: isFollowingViewer,
                    follows_viewer: followsViewer,
                    viewer_target_relationship: relationship,
                    calibration,
                    viewer_rated_entry_count: viewerRatedEntryCount,
                },
            });
        }

        // ── diary (read) ────────────────────────────────────────────────
        if (action === 'diary') {
            const { identifier, cursor, limit } = body as {
                identifier?: string;
                cursor?: string | null;
                limit?: number;
            };
            if (!identifier || typeof identifier !== 'string') {
                return fail('identifier is required', 400);
            }

            const targetProfile = await resolveProfile(supabase, identifier);
            if (!targetProfile) return notFound();

            const callerId = user.id;
            const targetId = targetProfile.user_id;
            const isSelf = callerId === targetId;

            if (!isSelf) {
                // TICKET-090 blocks + TICKET-093(a) audience gate — the decision
                // matrix is pinned by gates.test.ts.
                const blockState = await fetchBlockState(supabase, callerId, targetId);
                const sharedTableIds = blockState === 'none'
                    ? await fetchSharedTableIds(supabase, callerId, targetId)
                    : [];
                const relationship = computeRelationship(
                    callerId,
                    targetProfile.account_privacy,
                    sharedTableIds,
                );
                if (!strangerCanReadPalate(blockState, relationship)) {
                    return notFound();
                }
            }

            const pageLimit = Math.min(Math.max(limit ?? 30, 1), 50);
            // TICKET-044: pass includeRoundData=isSelf — public diary never surfaces
            // merged-round payloads; Tables are private and stay that way regardless
            // of account_privacy setting.
            const page = await fetchDiary(
                supabase,
                targetId,
                isSelf,
                cursor ?? null,
                pageLimit,
                isSelf, // includeRoundData — self-only privacy boundary
            );

            return json({ data: page });
        }

        // ── regulars (read) ────────────────────────────────────────────────
        if (action === 'regulars') {
            const { identifier } = body as { identifier?: string };
            if (!identifier || typeof identifier !== 'string') {
                return fail('identifier is required', 400);
            }

            const targetProfile = await resolveProfile(supabase, identifier);
            if (!targetProfile) return notFound();

            const callerId = user.id;
            const targetId = targetProfile.user_id;
            const isSelf = callerId === targetId;

            if (!isSelf) {
                // TICKET-090 blocks + TICKET-093(a) audience gate — the decision
                // matrix is pinned by gates.test.ts.
                const blockState = await fetchBlockState(supabase, callerId, targetId);
                const sharedTableIds = blockState === 'none'
                    ? await fetchSharedTableIds(supabase, callerId, targetId)
                    : [];
                const relationship = computeRelationship(
                    callerId,
                    targetProfile.account_privacy,
                    sharedTableIds,
                );
                if (!strangerCanReadPalate(blockState, relationship)) {
                    return notFound();
                }
            }

            const regulars = await fetchRegulars(supabase, targetId, isSelf, 200);
            return json({ data: { regulars } });
        }

        // ── spots (read) — TICKET-092: every distinct logged restaurant ────
        if (action === 'spots') {
            const { identifier } = body as { identifier?: string };
            if (!identifier || typeof identifier !== 'string') {
                return fail('identifier is required', 400);
            }

            const targetProfile = await resolveProfile(supabase, identifier);
            if (!targetProfile) return notFound();

            const callerId = user.id;
            const targetId = targetProfile.user_id;
            const isSelf = callerId === targetId;

            if (!isSelf) {
                // TICKET-090 blocks + TICKET-093(a) audience gate — the decision
                // matrix is pinned by gates.test.ts.
                const blockState = await fetchBlockState(supabase, callerId, targetId);
                const sharedTableIds = blockState === 'none'
                    ? await fetchSharedTableIds(supabase, callerId, targetId)
                    : [];
                const relationship = computeRelationship(
                    callerId,
                    targetProfile.account_privacy,
                    sharedTableIds,
                );
                if (!strangerCanReadPalate(blockState, relationship)) {
                    return notFound();
                }
            }

            const spots = await fetchSpots(supabase, targetId, isSelf, 500);
            return json({ data: { spots } });
        }

        // ── network_map_pins (read) — TICKET-124: the follow-graph fan-out ──
        // Caller-scoped (p_viewer = the JWT sub). Restaurants logged by the
        // people the caller FOLLOWS, one pin per restaurant, diary/spots
        // (looser) predicate — block exclusion + public-account gate live inside
        // the SECURITY DEFINER RPC, so there is no identifier / strangerCanRead
        // gate here (it never reads a target's palate — only the caller's own
        // follow set). Author names are batch-hydrated from `profiles` by id:
        // NEVER a PostgREST embed off entries (entries has no FK to profiles —
        // reference_entries_no_profiles_fk), same shape as co_diners above.
        if (action === 'network_map_pins') {
            const { data: rpcRows, error: rpcErr } = await supabase.rpc(
                'fn_network_map_pins',
                { p_viewer: user.id },
            );
            if (rpcErr) throw rpcErr;

            const rows = (rpcRows ?? []) as {
                restaurant_id: string;
                name: string;
                city: string | null;
                cuisine: string | null;
                lat: number;
                lng: number;
                author_id: string;
                entry_id: string;
                rating: number | null;
                note_snippet: string | null;
                has_review: boolean;
                others_count: number;
            }[];
            if (rows.length === 0) return json({ data: { pins: [] } });

            const authorIds = [...new Set(rows.map((r) => r.author_id))];
            const { data: profiles, error: profErr } = await supabase
                .from('profiles')
                .select('user_id, display_name, avatar_url')
                .in('user_id', authorIds);
            if (profErr) throw profErr;

            const byId = new Map(
                ((profiles ?? []) as {
                    user_id: string;
                    display_name: string | null;
                    avatar_url: string | null;
                }[]).map((p) => [p.user_id, p]),
            );

            // Preserve the RPC's most-recent-activity order. A vanished author
            // profile (deleted mid-flight) degrades to the 'Someone' fallback
            // rather than dropping the pin.
            const pins = rows.map((r) => {
                const p = byId.get(r.author_id);
                return {
                    restaurant_id: r.restaurant_id,
                    name: r.name ?? null,
                    city: r.city ?? null,
                    cuisine: r.cuisine ?? null,
                    lat: r.lat,
                    lng: r.lng,
                    author: {
                        id: r.author_id,
                        name: p?.display_name || 'Someone',
                        avatar: p?.avatar_url ?? null,
                    },
                    entry_id: r.entry_id,
                    rating: r.rating ?? null,
                    note: r.note_snippet ?? null,
                    // Routes the peek tap: true → the followee's review (entry-detail
                    // viewAs=public); false → the restaurant page. Never dead-ends.
                    has_review: r.has_review ?? false,
                    others_count: Number(r.others_count ?? 0),
                };
            });

            return json({ data: { pins } });
        }

        // ── reviews (read) — TICKET-092: diary rows with written notes ─────
        if (action === 'reviews') {
            const { identifier, cursor, limit } = body as {
                identifier?: string;
                cursor?: string | null;
                limit?: number;
            };
            if (!identifier || typeof identifier !== 'string') {
                return fail('identifier is required', 400);
            }

            const targetProfile = await resolveProfile(supabase, identifier);
            if (!targetProfile) return notFound();

            const callerId = user.id;
            const targetId = targetProfile.user_id;
            const isSelf = callerId === targetId;

            if (!isSelf) {
                // TICKET-090 blocks + TICKET-093(a) audience gate — the decision
                // matrix is pinned by gates.test.ts.
                const blockState = await fetchBlockState(supabase, callerId, targetId);
                const sharedTableIds = blockState === 'none'
                    ? await fetchSharedTableIds(supabase, callerId, targetId)
                    : [];
                const relationship = computeRelationship(
                    callerId,
                    targetProfile.account_privacy,
                    sharedTableIds,
                );
                if (!strangerCanReadPalate(blockState, relationship)) {
                    return notFound();
                }
            }

            const pageLimit = Math.min(Math.max(limit ?? 30, 1), 50);
            // includeRoundData=isSelf (Tables never public); reviewsOnly=true.
            const page = await fetchDiary(
                supabase,
                targetId,
                isSelf,
                cursor ?? null,
                pageLimit,
                isSelf,
                true,
            );
            return json({ data: page });
        }

        // ── taste (read) — category + cuisine taste drill-in ──────────────────
        // Public profiles use the same block + audience gate as every other
        // palate surface. The RPC receives include_private=false for non-self,
        // so private (and NULL-visibility) entries never enter any aggregate.
        if (action === 'taste') {
            const { identifier } = body as { identifier?: string };
            if (!identifier || typeof identifier !== 'string') {
                return fail('identifier is required', 400);
            }

            const targetProfile = await resolveProfile(supabase, identifier);
            if (!targetProfile) return notFound();

            const callerId = user.id;
            const targetId = targetProfile.user_id;
            const isSelf = callerId === targetId;
            let blockState: BlockState = 'none';
            let relationship: ViewerRelationship = 'self';
            if (!isSelf) {
                blockState = await fetchBlockState(supabase, callerId, targetId);
                const sharedTableIds = blockState === 'none'
                    ? await fetchSharedTableIds(supabase, callerId, targetId)
                    : [];
                relationship = computeRelationship(
                    callerId,
                    targetProfile.account_privacy,
                    sharedTableIds,
                );
            }

            const access = decideTasteAggregateAccess(
                callerId,
                targetId,
                blockState,
                relationship,
            );
            if (!access.allowed) return notFound();

            const { data: rows, error: tasteErr } = await supabase.rpc(
                'fn_user_taste',
                access.rpcArgs,
            );
            if (tasteErr) throw tasteErr;

            // The fn returns exactly one row (aggregate over the visibility-gated
            // entries — an empty set still yields one row with entry_count 0).
            const row = Array.isArray(rows) ? rows[0] : rows;
            if (!row) {
                // Defensive — should never happen, but never 500 the drill-in.
                return json({
                    data: {
                        entry_count: 0,
                        overall_avg: null,
                        categories: {
                            flavor: { avg: null, n: 0 },
                            service: { avg: null, n: 0 },
                            value: { avg: null, n: 0 },
                            vibe: { avg: null, n: 0 },
                        },
                        top_cuisines: [],
                        bottom_cuisines: [],
                        rating_histogram: [],
                    },
                });
            }

            return json({
                data: {
                    entry_count: row.entry_count ?? 0,
                    overall_avg: row.overall_avg ?? null,
                    categories: {
                        flavor: { avg: row.flavor_avg ?? null, n: row.flavor_n ?? 0 },
                        service: { avg: row.service_avg ?? null, n: row.service_n ?? 0 },
                        value: { avg: row.value_avg ?? null, n: row.value_n ?? 0 },
                        vibe: { avg: row.vibe_avg ?? null, n: row.vibe_n ?? 0 },
                    },
                    top_cuisines: row.top_cuisines ?? [],
                    bottom_cuisines: row.bottom_cuisines ?? [],
                    rating_histogram: row.rating_histogram ?? [],
                },
            });
        }

        // ── check_username ────────────────────────────────────────────────
        if (action === 'check_username') {
            const { username } = body;
            if (!username || typeof username !== 'string') {
                return fail('username is required', 400);
            }

            // Validate format first
            const usernameFormat = /^[a-z][a-z0-9_]{2,23}$/;
            if (!usernameFormat.test(username)) {
                return json({ data: { available: false, reason: 'invalid_format' } });
            }

            // Case-insensitive check
            const { data: existing, error } = await supabase
                .from('profiles')
                .select('user_id')
                .ilike('username', username)
                .neq('user_id', user.id) // exclude self (allow re-setting same username)
                .maybeSingle();
            if (error) throw error;

            return json({ data: { available: !existing } });
        }

        // ── update_profile ────────────────────────────────────────────────
        if (action === 'update_profile') {
            const updates: Record<string, unknown> = {};
            const hasAvatarUpdate = body.avatar_url !== undefined;
            const avatarUrl = body.avatar_url == null ? null : String(body.avatar_url).trim();

            if (typeof body.display_name === 'string') {
                const name = body.display_name.trim();
                if (!name || name.length > 80) return fail('display_name must be 1–80 chars', 400);
                updates.display_name = name;
            }
            if (body.bio !== undefined) {
                updates.bio = body.bio ? String(body.bio).slice(0, 160) : null;
            }
            if (body.home_city !== undefined) {
                const homeCity = body.home_city == null ? '' : String(body.home_city).trim();
                if (homeCity.length > 120) return fail('home_city must be at most 120 chars', 400);
                updates.home_city = homeCity || null;
            }
            if (hasAvatarUpdate && avatarUrl && avatarUrl.length > 500) {
                return fail('avatar_url is too long', 400);
            }

            if (Object.keys(updates).length === 0 && !hasAvatarUpdate) {
                return fail('No updatable fields provided', 400);
            }

            if (Object.keys(updates).length > 0) {
                const { error } = await supabase
                    .from('profiles')
                    .update(updates)
                    .eq('user_id', user.id);
                if (error) throw error;
            }

            // Avatar replacement/removal owns image-ref unbinding + GC enqueue.
            // Keep it in the SQL transaction that reads the live enforcement
            // flag; a service-role profiles.update here would bypass B-2.
            if (hasAvatarUpdate) {
                const { error } = await supabase.rpc('fn_commit_avatar', {
                    p_user_id: user.id,
                    p_avatar_url: avatarUrl || null,
                });
                if (error) throw error;
            }

            const { data: updated, error } = await supabase
                .from('profiles')
                .select('user_id, username, display_name, bio, avatar_url, home_city, account_privacy, allow_public_replies')
                .eq('user_id', user.id)
                .single();
            if (error) throw error;

            return json({ data: updated });
        }

        // ── complete_onboarding ───────────────────────────────────────────
        // TICKET-107: the atomic finish of the onboarding stack — writes name +
        // home_city and STAMPS onboarded_at in one update so the gate can never
        // be left half-set (name saved but onboarded_at NULL). home_city is the
        // FREE-TEXT profiles column (NOT set_user_home_city / claimed cities);
        // it's optional (skip on S2), capped, trimmed-to-null.
        //
        // TICKET-126: also carries the uploaded avatar_url (optional/nullable),
        // and UNCONDITIONALLY stamps terms_accepted_at (13+ / Terms acceptance —
        // every new user passes through this) and account_privacy='public'
        // (doctrine 2026-04-20: public-by-default with opt-out in settings). This
        // is written directly (not via update_privacy) so it deliberately
        // bypasses the "username required to go public" guard — onboarding
        // captures no username; opt-out and handle-claim live in settings.
        if (action === 'complete_onboarding') {
            let displayName: string | null = null;
            let homeCity: string | null = null;
            let avatarUrl: string | null = null;

            if (typeof body.display_name === 'string') {
                const name = body.display_name.trim();
                if (!name || name.length > 80) return fail('display_name must be 1–80 chars', 400);
                displayName = name;
            }
            // home_city is optional (skip) — trim to null, cap at 120 chars.
            if (body.home_city !== undefined) {
                const city = body.home_city == null ? '' : String(body.home_city).trim();
                homeCity = city ? city.slice(0, 120) : null;
            }
            // avatar_url is optional (skip) — trim to null. Defense-in-depth:
            // onboarding only ever produces our own storage URL, so pin it to the
            // caller's OWN avatars folder (blocks a crafted client persisting an
            // external tracking URL or another user's path through this action).
            if (body.avatar_url !== undefined) {
                const avatar = body.avatar_url == null ? '' : String(body.avatar_url).trim();
                if (avatar) {
                    const publicRoot = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/avatars/`;
                    const legacyPrefix = `${publicRoot}${user.id}/`;
                    const approvedPrefix = `${publicRoot}approved/${user.id}/`;
                    if (
                        avatar.length > 500 ||
                        (!avatar.startsWith(legacyPrefix) && !avatar.startsWith(approvedPrefix))
                    ) {
                        return fail('avatar_url must be an uploaded avatar', 400);
                    }
                    avatarUrl = avatar;
                }
            }

            // Full-payload RPC: flag read, approved-object validation, all
            // completion fields, onboarded_at/terms/privacy stamps, and avatar
            // ref binding commit atomically.  OFF remains legacy-compatible;
            // B-2 turns avatar null/raw into a closed failure.
            const { data: rpcData, error } = await supabase.rpc('fn_complete_onboarding', {
                p_user_id: user.id,
                p_display_name: displayName,
                p_home_city: homeCity,
                p_avatar_url: avatarUrl,
            });
            if (error) throw error;

            const updated = Array.isArray(rpcData) ? rpcData[0] : rpcData;

            return json({ data: updated });
        }

        // ── update_username ───────────────────────────────────────────────
        if (action === 'update_username') {
            const { username } = body;
            if (!username || typeof username !== 'string') {
                return fail('username is required', 400);
            }

            const usernameFormat = /^[a-z][a-z0-9_]{2,23}$/;
            if (!usernameFormat.test(username)) {
                return fail('Invalid username format', 400);
            }

            // Check uniqueness (case-insensitive)
            const { data: existing, error: checkErr } = await supabase
                .from('profiles')
                .select('user_id')
                .ilike('username', username)
                .neq('user_id', user.id)
                .maybeSingle();
            if (checkErr) throw checkErr;
            if (existing) return fail('Username already taken', 409);

            const { data: updated, error } = await supabase
                .from('profiles')
                .update({ username })
                .eq('user_id', user.id)
                .select('user_id, username, display_name, bio, avatar_url, account_privacy, allow_public_replies')
                .single();
            if (error) throw error;

            return json({ data: updated });
        }

        // ── update_privacy ────────────────────────────────────────────────
        if (action === 'update_privacy') {
            const { account_privacy, username } = body;
            if (account_privacy !== 'private' && account_privacy !== 'public') {
                return fail('account_privacy must be "private" or "public"', 400);
            }

            // Fetch current profile to check null-username guard
            const { data: currentProfile, error: fetchErr } = await supabase
                .from('profiles')
                .select('account_privacy, username')
                .eq('user_id', user.id)
                .single();
            if (fetchErr) throw fetchErr;

            const updates: Record<string, unknown> = { account_privacy };

            if (account_privacy === 'public') {
                // Atomic first-flip: if going public with no username, require username in same call
                if (!currentProfile.username && !username) {
                    return fail('username is required when making profile public for the first time', 400);
                }
                if (username) {
                    const usernameFormat = /^[a-z][a-z0-9_]{2,23}$/;
                    if (!usernameFormat.test(username)) {
                        return fail('Invalid username format', 400);
                    }
                    // Uniqueness check
                    const { data: existing, error: checkErr } = await supabase
                        .from('profiles')
                        .select('user_id')
                        .ilike('username', username)
                        .neq('user_id', user.id)
                        .maybeSingle();
                    if (checkErr) throw checkErr;
                    if (existing) return fail('Username already taken', 409);
                    updates.username = username;
                }
            }

            const { data: updated, error } = await supabase
                .from('profiles')
                .update(updates)
                .eq('user_id', user.id)
                .select('user_id, username, display_name, bio, avatar_url, account_privacy, allow_public_replies')
                .single();
            if (error) throw error;

            return json({ data: updated });
        }

        // ── update_reply_permission ───────────────────────────────────────
        if (action === 'update_reply_permission') {
            const { allow_public_replies } = body;
            if (typeof allow_public_replies !== 'boolean') {
                return fail('allow_public_replies must be a boolean', 400);
            }

            // TICKET-037 (P2-14): return full profile shape so optimistic patching
            // is consistent with other profile-update paths.
            const { data: updated, error } = await supabase
                .from('profiles')
                .update({ allow_public_replies })
                .eq('user_id', user.id)
                .select('user_id, username, display_name, bio, avatar_url, account_privacy, allow_public_replies')
                .single();
            if (error) throw error;

            return json({ data: updated });
        }

        // ── search ───────────────────────────────────────────────────────
        // Find Napkin users by display_name (ILIKE); excludes the caller.
        // Used by CompanionPickerSheet (TICKET-027) and PeopleSearchPane (TICKET-028).
        // Request: { action: 'search', q: string, limit?: number, mutual_only?: boolean }
        // Response (default): { data: { user_id, display_name, avatar_url, is_following }[] }
        // Response (mutual_only=true): all rows include is_mutual + is_following
        //   (caller→row) + follows_caller (row→caller), so callers can explain the
        //   non-mutual reason. mutuals sort first; non-mutuals still returned.
        // Order: followed/mutual users first, then by profiles.created_at DESC, then display_name ASC
        if (action === 'search') {
            const { q, limit: rawLimit, mutual_only: mutualOnly } = body as {
                q?: string;
                limit?: number;
                mutual_only?: boolean;
            };
            if (!q || typeof q !== 'string' || q.trim().length === 0) {
                return fail('q is required', 400);
            }

            const maxResults = Math.min(Math.max(rawLimit ?? 20, 1), 20);
            const pattern = `%${q.trim()}%`;

            const { data: results, error: searchErr } = await supabase
                .from('profiles')
                .select('user_id, display_name, avatar_url, created_at')
                .ilike('display_name', pattern)
                .neq('user_id', user.id)
                .limit(maxResults);

            if (searchErr) throw searchErr;

            const rows = (results ?? []) as Array<{
                user_id: string;
                display_name: string;
                avatar_url: string | null;
                created_at: string;
            }>;

            if (rows.length === 0) {
                return json({ data: [] });
            }

            // Fetch which of the results the caller is following (single IN lookup — no N+1)
            const resultIds = rows.map((r) => r.user_id);
            const { data: followRows } = await supabase
                .from('follows')
                .select('following_id')
                .eq('follower_id', user.id)
                .in('following_id', resultIds);

            const followingSet = new Set<string>(
                ((followRows ?? []) as { following_id: string }[]).map((f) => f.following_id)
            );

            if (mutualOnly) {
                // Fetch which of the result-set users follow the caller back
                const { data: reverseFollowRows } = await supabase
                    .from('follows')
                    .select('follower_id')
                    .eq('following_id', user.id)
                    .in('follower_id', resultIds);

                const followsCallerSet = new Set<string>(
                    ((reverseFollowRows ?? []) as { follower_id: string }[]).map((f) => f.follower_id)
                );

                // is_mutual iff caller→x AND x→caller both exist
                const isMutual = (userId: string) =>
                    followingSet.has(userId) && followsCallerSet.has(userId);

                // Sort: mutuals first, then non-mutuals. Within each group: created_at DESC, display_name ASC
                const sorted = rows.slice().sort((a, b) => {
                    const aM = isMutual(a.user_id) ? 1 : 0;
                    const bM = isMutual(b.user_id) ? 1 : 0;
                    if (aM !== bM) return bM - aM;
                    if (a.created_at > b.created_at) return -1;
                    if (a.created_at < b.created_at) return 1;
                    return a.display_name.localeCompare(b.display_name);
                });

                return json({
                    // Both direction sets are already in hand — surface them per
                    // row so send-surfaces can explain WHY someone is non-mutual
                    // (you don't follow them / they don't follow you back).
                    data: sorted.map((r) => ({
                        user_id: r.user_id,
                        display_name: r.display_name,
                        avatar_url: r.avatar_url ?? null,
                        is_following: followingSet.has(r.user_id),
                        follows_caller: followsCallerSet.has(r.user_id),
                        is_mutual: isMutual(r.user_id),
                    })),
                });
            }

            // Sort server-side: followed first, then by created_at DESC, then display_name ASC
            const sorted = rows.slice().sort((a, b) => {
                const aF = followingSet.has(a.user_id) ? 1 : 0;
                const bF = followingSet.has(b.user_id) ? 1 : 0;
                if (aF !== bF) return bF - aF; // followed first
                // created_at DESC
                if (a.created_at > b.created_at) return -1;
                if (a.created_at < b.created_at) return 1;
                // display_name ASC tiebreak
                return a.display_name.localeCompare(b.display_name);
            });

            return json({
                data: sorted.map((r) => ({
                    user_id: r.user_id,
                    display_name: r.display_name,
                    avatar_url: r.avatar_url ?? null,
                    is_following: followingSet.has(r.user_id),
                })),
            });
        }

        // ── follow ───────────────────────────────────────────────────────
        // Request: { action: 'follow', target_user_id: string }
        // Response: { data: { following: true } }
        if (action === 'follow') {
            const { target_user_id } = body as { target_user_id?: string };
            if (!target_user_id || typeof target_user_id !== 'string') {
                return fail('target_user_id is required', 400);
            }
            if (target_user_id === user.id) {
                return fail('cannot follow self', 400);
            }

            const { error: upsertErr } = await supabase
                .from('follows')
                .upsert(
                    { follower_id: user.id, following_id: target_user_id },
                    { onConflict: 'follower_id,following_id', ignoreDuplicates: true }
                );

            if (upsertErr) throw upsertErr;

            return json({ data: { following: true } });
        }

        // ── unfollow ─────────────────────────────────────────────────────
        // Request: { action: 'unfollow', target_user_id: string }
        // Response: { data: { following: false } }
        if (action === 'unfollow') {
            const { target_user_id } = body as { target_user_id?: string };
            if (!target_user_id || typeof target_user_id !== 'string') {
                return fail('target_user_id is required', 400);
            }
            if (target_user_id === user.id) {
                return fail('cannot unfollow self', 400);
            }

            const { error: deleteErr } = await supabase
                .from('follows')
                .delete()
                .eq('follower_id', user.id)
                .eq('following_id', target_user_id);

            if (deleteErr) throw deleteErr;

            return json({ data: { following: false } });
        }

        // ── check_follow ─────────────────────────────────────────────────
        // Request: { action: 'check_follow', target_user_id: string }
        // Response: { data: { is_following: boolean } }
        if (action === 'check_follow') {
            const { target_user_id } = body as { target_user_id?: string };
            if (!target_user_id || typeof target_user_id !== 'string') {
                return fail('target_user_id is required', 400);
            }

            const { data: followRow } = await supabase
                .from('follows')
                .select('follower_id')
                .eq('follower_id', user.id)
                .eq('following_id', target_user_id)
                .maybeSingle();

            return json({ data: { is_following: followRow !== null } });
        }

        // ── recent_companions ─────────────────────────────────────────────
        // Top five users the caller has tagged most often, re-authorized
        // against the current mutual-follow and either-direction block state.
        // Historical entry_companions rows are intentionally left untouched.
        // Request: { action: 'recent_companions' }
        // Response: { data: { user_id, display_name, avatar_url }[] }
        if (action === 'recent_companions') {
            return json({ data: await fetchRecentCompanions(supabase, user.id) });
        }

        // ── co_diners ─────────────────────────────────────────────────────
        // TICKET-101: co-diner follow candidates for the zero-follow feed empty
        // state (tier 1). The people the caller has actually eaten with on
        // Napkin — union of entry/supper/round/table co-attendance — ranked by
        // meals-together, minus existing follows / either-direction blocks /
        // self. The SECURITY DEFINER RPC does all the union/dedup/filter in SQL;
        // this handler just authenticates (caller = p_viewer) and hydrates
        // profile display fields. Aggregate counts only leave the RPC — never
        // raw event rows or a source breakdown.
        // Request: { action: 'co_diners' }
        // Response: { data: { user_id, display_name, avatar_url, meals_together }[] }
        //   (an empty array is a legitimate tier-2 signal — nobody they know yet).
        if (action === 'co_diners') {
            const { data: candidates, error: rpcErr } = await supabase.rpc(
                'fn_co_diner_candidates',
                { p_viewer: user.id, p_limit: 3 },
            );
            if (rpcErr) throw rpcErr;

            const rows = (candidates ?? []) as { co_diner_id: string; meals_together: number }[];
            if (rows.length === 0) return json({ data: [] });

            const ids = rows.map((r) => r.co_diner_id);
            // Flat profile lookup by id — NOT a PostgREST embed off the RPC, so
            // no PGRST201 ambiguity (entries has no FK to profiles anyway).
            const { data: profiles, error: profErr } = await supabase
                .from('profiles')
                .select('user_id, display_name, avatar_url')
                .in('user_id', ids);
            if (profErr) throw profErr;

            const byId = new Map(
                ((profiles ?? []) as {
                    user_id: string;
                    display_name: string;
                    avatar_url: string | null;
                }[]).map((p) => [p.user_id, p]),
            );

            // Preserve the RPC's meals_together DESC order; drop any candidate
            // whose profile row vanished (deleted mid-flight).
            return json({
                data: rows
                    .map((r) => {
                        const p = byId.get(r.co_diner_id);
                        if (!p) return null;
                        return {
                            user_id: p.user_id,
                            display_name: p.display_name,
                            avatar_url: p.avatar_url ?? null,
                            meals_together: Number(r.meals_together ?? 0),
                        };
                    })
                    .filter(Boolean),
            });
        }

        // ── follow_candidates ─────────────────────────────────────────────
        // TICKET-189: the people-to-follow v2 mixed rail — co-diners FIRST
        // (Ring 1 > Ring-2-lite), then recently-active public authors, one
        // capped list. The two RPCs stay separately testable; this handler
        // owns only the trivial merge/dedup/cap presentation logic:
        //   1. fn_co_diner_candidates(p_viewer, 8)      — people actually eaten
        //      with, minus follows/blocks/self.
        //   2. fn_recently_active_public_authors(p_viewer, co_diner_ids, 8) —
        //      public accounts with ≥1 publicly-eligible log in 30d; the
        //      co-diner id set is excluded INSIDE the RPC before its LIMIT so
        //      the publics are genuinely beyond co-diners (a co-diner never
        //      re-appears as a "public").
        // Request: { action: 'follow_candidates' }
        // Response: { data: FollowCandidate[] } — FollowCandidate =
        //   { user_id, display_name, avatar_url, kind: 'co_diner' | 'public',
        //     meals_together?, logs_30d? }. Cap 8 total. Empty is legitimate.
        // `co_diners` above stays unchanged (onboarding still uses it).
        if (action === 'follow_candidates') {
            const CANDIDATE_CAP = 8;

            const { data: coDiners, error: coErr } = await supabase.rpc(
                'fn_co_diner_candidates',
                { p_viewer: user.id, p_limit: CANDIDATE_CAP },
            );
            if (coErr) throw coErr;
            const coRows = (coDiners ?? []) as { co_diner_id: string; meals_together: number }[];

            const { data: publics, error: pubErr } = await supabase.rpc(
                'fn_recently_active_public_authors',
                {
                    p_viewer: user.id,
                    p_exclude_ids: coRows.map((r) => r.co_diner_id),
                    p_limit: CANDIDATE_CAP,
                },
            );
            if (pubErr) throw pubErr;
            const pubRows = (publics ?? []) as { author_id: string; logs_30d: number }[];

            const orderedIds = [
                ...coRows.map((r) => r.co_diner_id),
                ...pubRows.map((r) => r.author_id),
            ];
            if (orderedIds.length === 0) return json({ data: [] });

            // Flat profile lookup — NOT a PostgREST embed (entries/RPCs have no
            // FK to profiles; same shape as co_diners above).
            const { data: profiles, error: profErr } = await supabase
                .from('profiles')
                .select('user_id, display_name, avatar_url')
                .in('user_id', orderedIds);
            if (profErr) throw profErr;

            const byId = new Map(
                ((profiles ?? []) as {
                    user_id: string;
                    display_name: string;
                    avatar_url: string | null;
                }[]).map((p) => [p.user_id, p]),
            );

            const candidates = [
                ...coRows.map((r) => {
                    const p = byId.get(r.co_diner_id);
                    if (!p) return null;
                    return {
                        user_id: p.user_id,
                        display_name: p.display_name,
                        avatar_url: p.avatar_url ?? null,
                        kind: 'co_diner' as const,
                        meals_together: Number(r.meals_together ?? 0),
                    };
                }),
                ...pubRows.map((r) => {
                    const p = byId.get(r.author_id);
                    if (!p) return null;
                    return {
                        user_id: p.user_id,
                        display_name: p.display_name,
                        avatar_url: p.avatar_url ?? null,
                        kind: 'public' as const,
                        logs_30d: Number(r.logs_30d ?? 0),
                    };
                }),
            ].filter(Boolean).slice(0, CANDIDATE_CAP);

            return json({ data: candidates });
        }

        // ── following_list ────────────────────────────────────────────────
        // Returns the list of users the caller is following (with profile data).
        // Request: { action: 'following_list', limit?: number }
        // Response: { data: { user_id, display_name, avatar_url }[] }
        if (action === 'following_list') {
            const { limit: rawLimit } = body as { limit?: number };
            const maxResults = Math.min(Math.max(rawLimit ?? 50, 1), 50);

            const { data: followRows, error: followErr } = await supabase
                .from('follows')
                .select('following_id, created_at')
                .eq('follower_id', user.id)
                .order('created_at', { ascending: false })
                .limit(maxResults);

            if (followErr) throw followErr;

            const rows = (followRows ?? []) as { following_id: string; created_at: string }[];
            if (rows.length === 0) return json({ data: [] });

            const ids = rows.map((r) => r.following_id);
            const { data: profiles, error: profilesErr } = await supabase
                .from('profiles')
                .select('user_id, display_name, avatar_url')
                .in('user_id', ids);

            if (profilesErr) throw profilesErr;

            // Return in follow-recency order
            const byId = new Map(
                ((profiles ?? []) as { user_id: string; display_name: string; avatar_url: string | null }[])
                    .map((p) => [p.user_id, p])
            );

            return json({
                data: ids
                    .map((id) => byId.get(id))
                    .filter(Boolean)
                    .map((p: any) => ({
                        user_id: p.user_id,
                        display_name: p.display_name,
                        avatar_url: p.avatar_url ?? null,
                        is_following: true,
                    })),
            });
        }

        // ── follow_list ───────────────────────────────────────────────────
        // Returns followers or following for an arbitrary user, with privacy gating.
        // Request: { action: 'follow_list', kind: 'followers' | 'following', target_user_id: string, limit?: number }
        // Response: { data: { user_id, display_name, avatar_url, is_following }[] }
        //   is_following = does the caller follow this listed user
        //
        // Gating: caller must have palate access to the target —
        //   self OR target.account_privacy='public' OR shared tables.
        if (action === 'follow_list') {
            const { kind, target_user_id, limit: rawLimit } = body as {
                kind?: 'followers' | 'following';
                target_user_id?: string;
                limit?: number;
            };
            if (kind !== 'followers' && kind !== 'following') {
                return fail('kind must be "followers" or "following"', 400);
            }
            if (!target_user_id || typeof target_user_id !== 'string') {
                return fail('target_user_id is required', 400);
            }

            const callerId = user.id;
            const isSelf = callerId === target_user_id;

            // Privacy gate — same access rules as the rest of the palate.
            if (!isSelf) {
                const { data: targetRow, error: targetErr } = await supabase
                    .from('profiles')
                    .select('account_privacy')
                    .eq('user_id', target_user_id)
                    .maybeSingle();
                if (targetErr) throw targetErr;
                if (!targetRow) return notFound();

                if (targetRow.account_privacy !== 'public') {
                    const sharedTableIds = await fetchSharedTableIds(supabase, callerId, target_user_id);
                    if (sharedTableIds.length === 0) return notFound();
                }
            }

            const maxResults = Math.min(Math.max(rawLimit ?? 100, 1), 200);

            // Fetch follow edges — select the "other side" column based on kind.
            const filterCol = kind === 'followers' ? 'following_id' : 'follower_id';
            const otherCol = kind === 'followers' ? 'follower_id' : 'following_id';

            const { data: followRows, error: followErr } = await supabase
                .from('follows')
                .select(`${filterCol}, ${otherCol}, created_at`)
                .eq(filterCol, target_user_id)
                .order('created_at', { ascending: false })
                .limit(maxResults);
            if (followErr) throw followErr;

            const rows = (followRows ?? []) as Record<string, any>[];
            if (rows.length === 0) return json({ data: [] });

            const ids = rows.map((r) => r[otherCol] as string);
            const [profilesRes, callerFollowsRes] = await Promise.all([
                supabase
                    .from('profiles')
                    .select('user_id, display_name, username, avatar_url')
                    .in('user_id', ids),
                // Resolve is_following (caller → each listed user) in one query
                supabase
                    .from('follows')
                    .select('following_id')
                    .eq('follower_id', callerId)
                    .in('following_id', ids),
            ]);
            if (profilesRes.error) throw profilesRes.error;
            if (callerFollowsRes.error) throw callerFollowsRes.error;

            const followingSet = new Set<string>(
                ((callerFollowsRes.data ?? []) as { following_id: string }[])
                    .map((f) => f.following_id),
            );

            const byId = new Map(
                ((profilesRes.data ?? []) as {
                    user_id: string;
                    display_name: string;
                    username: string | null;
                    avatar_url: string | null;
                }[]).map((p) => [p.user_id, p]),
            );

            return json({
                data: ids
                    .map((id) => byId.get(id))
                    .filter(Boolean)
                    .map((p: any) => ({
                        user_id: p.user_id,
                        display_name: p.display_name,
                        username: p.username ?? null,
                        avatar_url: p.avatar_url ?? null,
                        is_following: followingSet.has(p.user_id),
                    })),
            });
        }

        return fail('Unknown action', 400);

    } catch (err) {
        const details = err instanceof Error
            ? err.message
            : typeof err === 'object' && err !== null
                ? JSON.stringify(err)
                : String(err);
        console.error('user-profile error:', details);
        reportError(err, { fn: 'user-profile' });
        return json({ error: 'Internal Server Error', details }, 500);
    }
});
