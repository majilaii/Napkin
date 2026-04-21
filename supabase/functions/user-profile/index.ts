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
 *   update_profile         — display_name, bio, avatar_url (partial update)
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

// ── Constants ──────────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Types ──────────────────────────────────────────────────────────────────

type ViewerRelationship =
    | 'self'
    | 'tables_in_common'
    | 'public_only'
    | 'public_and_tables'
    | 'none';

type ProfileRow = {
    user_id: string;
    username: string | null;
    display_name: string;
    bio: string | null;
    avatar_url: string | null;
    account_privacy: 'private' | 'public';
    allow_public_replies: boolean;
};

type Stats = {
    total_logs: number;
    total_restaurants: number;
    average_rating: number | null;
};

type ListSummary = {
    id: string;
    title: string;
    entry_count: number;
    ranked: boolean;
    privacy: 'public' | 'private';
    updated_at: string;
    cover_photo_url: string | null;
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
    photo_url: string | null;
    max_rating: number;
    visit_count: number;
    last_visited_at: string | null;
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
 * Compute viewer ↔ target relationship.
 * Must be called BEFORE any Palate data fetching.
 */
function computeRelationship(
    callerId: string,
    targetPrivacy: 'private' | 'public',
    sharedTableIds: string[],
): ViewerRelationship {
    const hasSharedTables = sharedTableIds.length > 0;

    if (targetPrivacy === 'public' && hasSharedTables) return 'public_and_tables';
    if (targetPrivacy === 'public') return 'public_only';
    if (hasSharedTables) return 'tables_in_common';
    return 'none';
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
            .select('user_id, username, display_name, bio, avatar_url, account_privacy, allow_public_replies')
            .eq('user_id', identifier)
            .maybeSingle()
        : await supabase
            .from('profiles')
            .select('user_id, username, display_name, bio, avatar_url, account_privacy, allow_public_replies')
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
async function fetchStats(supabase: any, targetId: string): Promise<Stats> {
    const { data: entries, error } = await supabase
        .from('entries')
        .select('id, restaurant_id, rating')
        .eq('user_id', targetId)
        .neq('visibility', 'private')
        .not('rating', 'is', null);
    if (error) throw error;

    const rows = (entries ?? []) as Array<{ id: string; restaurant_id: string | null; rating: number | null }>;
    const totalLogs = rows.length;
    const uniqueRestaurants = new Set(rows.map((r) => r.restaurant_id).filter(Boolean));
    const totalRestaurants = uniqueRestaurants.size;

    const ratedRows = rows.filter((r) => r.rating != null);
    const averageRating =
        ratedRows.length > 0
            ? ratedRows.reduce((sum, r) => sum + (r.rating as number), 0) / ratedRows.length
            : null;

    return { total_logs: totalLogs, total_restaurants: totalRestaurants, average_rating: averageRating };
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
            .select('restaurant:restaurants(photo_url)')
            .eq('list_id', list.id)
            .order(orderCol, { ascending: !!list.ranked })
            .limit(1)
            .maybeSingle();

        enriched.push({
            id: list.id,
            title: list.title,
            entry_count: count ?? 0,
            ranked: list.ranked,
            privacy: list.privacy,
            updated_at: list.updated_at,
            cover_photo_url: (firstEntry?.restaurant as any)?.photo_url ?? null,
        });
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
async function fetchTopFour(
    supabase: any,
    userId: string,
    includePrivate: boolean,
): Promise<TopPick[]> {
    let query = supabase
        .from('entries')
        .select('restaurant_id, rating, visited_at, created_at')
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
    };

    const buckets = new Map<string, Bucket>();
    for (const e of (entries ?? []) as any[]) {
        const rid = e.restaurant_id as string;
        const rating = Number(e.rating);
        const visited = (e.visited_at ?? e.created_at) as string;
        const existing = buckets.get(rid);
        if (!existing) {
            buckets.set(rid, {
                restaurant_id: rid,
                max_rating: rating,
                visit_count: 1,
                last_visited_at: visited,
            });
        } else {
            existing.max_rating = Math.max(existing.max_rating, rating);
            existing.visit_count += 1;
            if (!existing.last_visited_at || visited > existing.last_visited_at) {
                existing.last_visited_at = visited;
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
        .select('id, name, city, photo_url')
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
                photo_url: rest.photo_url ?? null,
                max_rating: r.max_rating,
                visit_count: r.visit_count,
                last_visited_at: r.last_visited_at,
            };
        })
        .filter((x): x is TopPick => x !== null);
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

    const { data: rests, error: restErr } = await supabase
        .from('restaurants')
        .select('id, name, city, photo_url')
        .in('id', eligible.map((r) => r.restaurant_id));
    if (restErr) throw restErr;

    const byId = new Map<string, any>((rests ?? []).map((r: any) => [r.id, r]));
    return eligible
        .map((r): RegularSummary | null => {
            const rest = byId.get(r.restaurant_id);
            if (!rest) return null;
            return {
                restaurant_id: r.restaurant_id,
                name: rest.name,
                city: rest.city ?? null,
                photo_url: rest.photo_url ?? null,
                visit_count: r.visit_count,
                avg_rating: r.rating_count > 0 ? r.rating_sum / r.rating_count : null,
                last_visited_at: r.last_visited_at,
            };
        })
        .filter((x): x is RegularSummary => x !== null);
}

/**
 * Fetch diary rows for a user — chronological, paginated via visited_at cursor.
 */
async function fetchDiary(
    supabase: any,
    userId: string,
    includePrivate: boolean,
    cursor: string | null,
    limit: number = 30,
): Promise<{ rows: DiaryRow[]; nextCursor: string | null }> {
    let query = supabase
        .from('entries')
        .select('id, restaurant_id, rating, note, visited_at, created_at, restaurants(name, city, photo_url)')
        .eq('user_id', userId)
        .not('restaurant_id', 'is', null)
        .order('visited_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit + 1);

    if (!includePrivate) query = query.neq('visibility', 'private');
    if (cursor) query = query.lt('visited_at', cursor);

    const { data: entries, error } = await query;
    if (error) throw error;

    const rows = (entries ?? []) as any[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const mapped: DiaryRow[] = page.map((e) => {
        const rest = Array.isArray(e.restaurants) ? e.restaurants[0] : e.restaurants;
        return {
            entry_id: e.id,
            restaurant_id: e.restaurant_id,
            restaurant_name: rest?.name ?? 'Unknown',
            city: rest?.city ?? null,
            photo_url: rest?.photo_url ?? null,
            rating: e.rating,
            note: e.note ?? null,
            visited_at: e.visited_at ?? e.created_at,
            created_at: e.created_at,
        };
    });

    const nextCursor = hasMore ? (mapped[mapped.length - 1]?.visited_at ?? null) : null;
    return { rows: mapped, nextCursor };
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
                const [stats, publicLists, recentlyLogged, topFour, regularsPreview, allTableIds] =
                    await Promise.all([
                        fetchStats(supabase, targetId),
                        fetchPublicLists(supabase, targetId),
                        fetchRecentlyLogged(supabase, targetId),
                        fetchTopFour(supabase, targetId, true),
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
                        regulars_preview: regularsPreview,
                        is_self: true,
                        is_following_viewer: false, // self never follows self
                        viewer_target_relationship: 'self' as ViewerRelationship,
                    },
                });
            }

            // 2. Compute relationship BEFORE any palate DB reads
            const sharedTableIds = await fetchSharedTableIds(supabase, callerId, targetId);
            const relationship = computeRelationship(callerId, targetProfile.account_privacy, sharedTableIds);

            // 3. 'none' → return not_found, stop here
            if (relationship === 'none') return notFound();

            // 4. Check if the caller is already following the target
            const { data: followRow } = await supabase
                .from('follows')
                .select('follower_id')
                .eq('follower_id', callerId)
                .eq('following_id', targetId)
                .maybeSingle();
            const isFollowingViewer = followRow !== null;

            // 5. 'tables_in_common' only — no palate access
            if (relationship === 'tables_in_common') {
                const tablePreviews = await fetchTablePreviews(supabase, targetId, sharedTableIds, 'other');
                return json({
                    data: {
                        profile: targetProfile,
                        stats: null,
                        public_lists: null,
                        recently_logged: null,
                        tables_in_common: tablePreviews,
                        top_four: [],
                        regulars_preview: [],
                        is_self: false,
                        is_following_viewer: isFollowingViewer,
                        viewer_target_relationship: relationship,
                    },
                });
            }

            // 6. public_only or public_and_tables — fetch palate
            const [stats, publicLists, recentlyLogged, topFour, regularsPreview] = await Promise.all([
                fetchStats(supabase, targetId),
                fetchPublicLists(supabase, targetId),
                fetchRecentlyLogged(supabase, targetId),
                fetchTopFour(supabase, targetId, false),
                fetchRegulars(supabase, targetId, false, 8),
            ]);

            let tablePreviews: TablePreview[] = [];
            if (relationship === 'public_and_tables') {
                tablePreviews = await fetchTablePreviews(supabase, targetId, sharedTableIds, 'other');
            }

            return json({
                data: {
                    profile: targetProfile,
                    stats,
                    public_lists: publicLists,
                    recently_logged: recentlyLogged,
                    tables_in_common: tablePreviews,
                    top_four: topFour,
                    regulars_preview: regularsPreview,
                    is_self: false,
                    is_following_viewer: isFollowingViewer,
                    viewer_target_relationship: relationship,
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
                const sharedTableIds = await fetchSharedTableIds(supabase, callerId, targetId);
                const relationship = computeRelationship(
                    callerId,
                    targetProfile.account_privacy,
                    sharedTableIds,
                );
                if (relationship === 'none' || relationship === 'tables_in_common') {
                    return notFound();
                }
            }

            const pageLimit = Math.min(Math.max(limit ?? 30, 1), 100);
            const { rows, nextCursor } = await fetchDiary(
                supabase,
                targetId,
                isSelf,
                cursor ?? null,
                pageLimit,
            );

            return json({ data: { rows, next_cursor: nextCursor } });
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
                const sharedTableIds = await fetchSharedTableIds(supabase, callerId, targetId);
                const relationship = computeRelationship(
                    callerId,
                    targetProfile.account_privacy,
                    sharedTableIds,
                );
                if (relationship === 'none' || relationship === 'tables_in_common') {
                    return notFound();
                }
            }

            const regulars = await fetchRegulars(supabase, targetId, isSelf, 200);
            return json({ data: { regulars } });
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

            if (typeof body.display_name === 'string') {
                const name = body.display_name.trim();
                if (!name || name.length > 80) return fail('display_name must be 1–80 chars', 400);
                updates.display_name = name;
            }
            if (body.bio !== undefined) {
                updates.bio = body.bio ? String(body.bio).slice(0, 160) : null;
            }
            if (body.avatar_url !== undefined) {
                updates.avatar_url = body.avatar_url ? String(body.avatar_url) : null;
            }

            if (Object.keys(updates).length === 0) {
                return fail('No updatable fields provided', 400);
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

            const { data: updated, error } = await supabase
                .from('profiles')
                .update({ allow_public_replies })
                .eq('user_id', user.id)
                .select('user_id, allow_public_replies, account_privacy')
                .single();
            if (error) throw error;

            return json({ data: updated });
        }

        // ── search ───────────────────────────────────────────────────────
        // Find Napkin users by display_name (ILIKE); excludes the caller.
        // Used by CompanionPickerSheet (TICKET-027) and PeopleSearchPane (TICKET-028).
        // Request: { action: 'search', q: string, limit?: number, mutual_only?: boolean }
        // Response (default): { data: { user_id, display_name, avatar_url, is_following }[] }
        // Response (mutual_only=true): all rows include is_mutual: boolean.
        //   mutuals sort first; non-mutuals still returned but flagged is_mutual=false.
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
                    data: sorted.map((r) => ({
                        user_id: r.user_id,
                        display_name: r.display_name,
                        avatar_url: r.avatar_url ?? null,
                        is_following: followingSet.has(r.user_id),
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

        return fail('Unknown action', 400);

    } catch (err) {
        const details = err instanceof Error
            ? err.message
            : typeof err === 'object' && err !== null
                ? JSON.stringify(err)
                : String(err);
        console.error('user-profile error:', details);
        return json({ error: 'Internal Server Error', details }, 500);
    }
});
