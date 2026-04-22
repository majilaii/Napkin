/**
 * Table Atlas Edge Function
 *
 * Geographic lens on a Table's dining history, grouped by city.
 *
 * Actions:
 *   POST { action: 'city-index', table_id } → stat line + city list
 *   POST { action: 'city-page', table_id, city } → restaurant tiles for a city
 *
 * Auth: caller must be a member of table_id (manual check via service-role client).
 * Restaurants without a city are excluded.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

// ── Types ─────────────────────────────────────────────────────────────────────

type CityRow = {
    name: string;
    spot_count: number;
    member_count: number;
    last_visit_at: string;
    hero_photo_url: string | null;
};

type AtlasStats = {
    members: number;
    cities: number;
    spots: number;
    founded_at: string | null;
};

type CityIndexResponse = {
    stats: AtlasStats;
    cities: CityRow[];
};

type VisitRow = {
    kind: 'round' | 'solo';
    id: string;
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    rating: number | null;
    date: string;
    table_night_id?: string;
    entry_id?: string;
};

type RestaurantTile = {
    id: string;
    name: string;
    cuisine: string | null;
    photo_url: string | null;
    lat: number | null;
    lng: number | null;
    rating: number | null;
    tile_type: 'solo' | 'round' | 'mixed';
    wished_by_viewer: boolean;
    companion_ids: string[];
    visits: VisitRow[];
    /** For micro-line: round count + solo count */
    round_count: number;
    solo_count: number;
    /** Unique member user_ids who visited */
    member_ids: string[];
    /** Member display names for avatar stack */
    member_names: string[];
    member_avatar_urls: (string | null)[];
};

type CityStats = {
    city: string;
    spot_count: number;
    member_count: number;
};

type CityPageResponse = {
    city: string;
    city_stats: CityStats;
    restaurants: RestaurantTile[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function fail(message: string, status = 400): Response {
    return json({ error: message }, status);
}

async function checkMembership(
    supabase: any,
    userId: string,
    tableId: string,
): Promise<boolean> {
    const { data, error } = await supabase
        .from('table_members')
        .select('member_id')
        .eq('table_id', tableId)
        .eq('member_id', userId)
        .maybeSingle();
    if (error) throw error;
    return data != null;
}

async function fetchProfiles(
    supabase: any,
    userIds: string[],
): Promise<Map<string, { display_name: string; avatar_url: string | null }>> {
    const map = new Map<string, { display_name: string; avatar_url: string | null }>();
    if (userIds.length === 0) return map;
    const unique = [...new Set(userIds)];
    const { data, error } = await supabase
        .from('profiles')
        .select('user_id, display_name, avatar_url')
        .in('user_id', unique);
    if (error) throw error;
    for (const p of (data ?? []) as any[]) {
        map.set(p.user_id, {
            display_name: p.display_name ?? 'Member',
            avatar_url: p.avatar_url ?? null,
        });
    }
    return map;
}

// ── Action: city-index ────────────────────────────────────────────────────────

async function handleCityIndex(
    supabase: any,
    userId: string,
    tableId: string,
): Promise<Response> {
    // Fetch table record for founding date and member count
    const { data: tableRow, error: tableErr } = await supabase
        .from('tables')
        .select('id, created_at')
        .eq('id', tableId)
        .maybeSingle();
    if (tableErr) throw tableErr;

    const { data: memberRows, error: memberErr } = await supabase
        .from('table_members')
        .select('member_id')
        .eq('table_id', tableId);
    if (memberErr) throw memberErr;
    const totalMembers = (memberRows ?? []).length;

    // ── Solo entries for this table ───────────────────────────────────────────
    const { data: entries, error: entryErr } = await supabase
        .from('entries')
        .select(`
            id,
            user_id,
            restaurant_id,
            rating,
            visited_at,
            created_at,
            restaurants (
                id,
                name,
                city,
                photo_url,
                latitude,
                longitude
            )
        `)
        .eq('table_id', tableId)
        .not('restaurants.city', 'is', null);
    if (entryErr) throw entryErr;

    // ── Rounds for this table ─────────────────────────────────────────────────
    const { data: nights, error: nightErr } = await supabase
        .from('table_nights')
        .select(`
            id,
            restaurant_id,
            average_rating,
            revealed_at,
            created_at,
            restaurants (
                id,
                name,
                city,
                photo_url,
                latitude,
                longitude
            ),
            table_night_participants (
                user_id,
                rating
            )
        `)
        .eq('table_id', tableId)
        .not('restaurants.city', 'is', null);
    if (nightErr) throw nightErr;

    // ── Aggregate by city ─────────────────────────────────────────────────────
    // Map: city → { restaurant_ids: Set, user_ids: Set, last_visit_at, photo }
    const cityMap = new Map<
        string,
        {
            restaurant_ids: Set<string>;
            user_ids: Set<string>;
            last_visit_at: string;
            hero_photo_url: string | null;
        }
    >();

    function upsertCity(
        city: string,
        restaurantId: string,
        userId: string | null,
        date: string,
        photo: string | null,
    ) {
        if (!city) return;
        const existing = cityMap.get(city);
        if (!existing) {
            cityMap.set(city, {
                restaurant_ids: new Set([restaurantId]),
                user_ids: new Set(userId ? [userId] : []),
                last_visit_at: date,
                hero_photo_url: photo,
            });
        } else {
            existing.restaurant_ids.add(restaurantId);
            if (userId) existing.user_ids.add(userId);
            if (date > existing.last_visit_at) existing.last_visit_at = date;
            if (!existing.hero_photo_url && photo) existing.hero_photo_url = photo;
        }
    }

    for (const e of (entries ?? []) as any[]) {
        const r = e.restaurants;
        if (!r || !r.city) continue;
        upsertCity(r.city, r.id, e.user_id, e.visited_at ?? e.created_at, r.photo_url);
    }
    for (const n of (nights ?? []) as any[]) {
        const r = n.restaurants;
        if (!r || !r.city) continue;
        const date = n.revealed_at ?? n.created_at;
        // Add each participant as a user
        for (const p of (n.table_night_participants ?? []) as any[]) {
            upsertCity(r.city, r.id, p.user_id, date, r.photo_url);
        }
        if ((n.table_night_participants ?? []).length === 0) {
            upsertCity(r.city, r.id, null, date, r.photo_url);
        }
    }

    // Sort cities by last_visit_at DESC
    const sortedCities: CityRow[] = Array.from(cityMap.entries())
        .sort(([, a], [, b]) => b.last_visit_at.localeCompare(a.last_visit_at))
        .map(([name, data]) => ({
            name,
            spot_count: data.restaurant_ids.size,
            member_count: data.user_ids.size,
            last_visit_at: data.last_visit_at,
            hero_photo_url: data.hero_photo_url,
        }));

    const stats: AtlasStats = {
        members: totalMembers,
        cities: sortedCities.length,
        spots: new Set(
            sortedCities.flatMap(() => []),
        ).size || sortedCities.reduce((sum, c) => sum + c.spot_count, 0),
        founded_at: tableRow?.created_at ?? null,
    };

    const response: CityIndexResponse = { stats, cities: sortedCities };
    return json({ data: response });
}

// ── Action: city-page ─────────────────────────────────────────────────────────

async function handleCityPage(
    supabase: any,
    userId: string,
    tableId: string,
    city: string,
): Promise<Response> {
    // ── Solo entries in this city ─────────────────────────────────────────────
    const { data: entries, error: entryErr } = await supabase
        .from('entries')
        .select(`
            id,
            user_id,
            restaurant_id,
            rating,
            visited_at,
            created_at,
            companion_ids,
            restaurants (
                id,
                name,
                cuisine,
                city,
                photo_url,
                latitude,
                longitude
            )
        `)
        .eq('table_id', tableId)
        .eq('restaurants.city', city);
    if (entryErr) throw entryErr;

    // ── Rounds in this city ────────────────────────────────────────────────────
    const { data: nights, error: nightErr } = await supabase
        .from('table_nights')
        .select(`
            id,
            restaurant_id,
            average_rating,
            revealed_at,
            created_at,
            restaurants (
                id,
                name,
                cuisine,
                city,
                photo_url,
                latitude,
                longitude
            ),
            table_night_participants (
                user_id,
                rating
            )
        `)
        .eq('table_id', tableId)
        .eq('restaurants.city', city);
    if (nightErr) throw nightErr;

    // ── Viewer's wishlist restaurant IDs ──────────────────────────────────────
    const { data: wishlistRows, error: wishErr } = await supabase
        .from('wishlist_items')
        .select('restaurant_id')
        .eq('user_id', userId);
    if (wishErr) throw wishErr;
    const wishedIds = new Set(
        (wishlistRows ?? []).map((w: any) => w.restaurant_id as string),
    );

    // ── Collect all user IDs for profile fetch ────────────────────────────────
    const allUserIds = new Set<string>();
    for (const e of (entries ?? []) as any[]) allUserIds.add(e.user_id);
    for (const n of (nights ?? []) as any[]) {
        for (const p of (n.table_night_participants ?? []) as any[]) {
            allUserIds.add(p.user_id);
        }
    }
    const profiles = await fetchProfiles(supabase, [...allUserIds]);

    // ── Build per-restaurant aggregates ──────────────────────────────────────
    type RestaurantAgg = {
        id: string;
        name: string;
        cuisine: string | null;
        photo_url: string | null;
        lat: number | null;
        lng: number | null;
        round_visits: {
            night_id: string;
            average_rating: number | null;
            date: string;
            participant_user_ids: string[];
        }[];
        solo_visits: {
            entry_id: string;
            user_id: string;
            rating: number | null;
            date: string;
        }[];
        companion_ids_union: Set<string>;
    };

    const restaurantMap = new Map<string, RestaurantAgg>();

    function ensureRestaurant(r: any): RestaurantAgg {
        if (!restaurantMap.has(r.id)) {
            restaurantMap.set(r.id, {
                id: r.id,
                name: r.name,
                cuisine: r.cuisine ?? null,
                photo_url: r.photo_url ?? null,
                lat: r.latitude ?? null,
                lng: r.longitude ?? null,
                round_visits: [],
                solo_visits: [],
                companion_ids_union: new Set(),
            });
        }
        return restaurantMap.get(r.id)!;
    }

    for (const e of (entries ?? []) as any[]) {
        const r = e.restaurants;
        if (!r || r.city !== city) continue;
        const agg = ensureRestaurant(r);
        agg.solo_visits.push({
            entry_id: e.id,
            user_id: e.user_id,
            rating: e.rating ?? null,
            date: e.visited_at ?? e.created_at,
        });
        for (const cId of (e.companion_ids ?? []) as string[]) {
            agg.companion_ids_union.add(cId);
        }
    }

    for (const n of (nights ?? []) as any[]) {
        const r = n.restaurants;
        if (!r || r.city !== city) continue;
        const agg = ensureRestaurant(r);
        const participantUserIds = (n.table_night_participants ?? []).map(
            (p: any) => p.user_id as string,
        );
        agg.round_visits.push({
            night_id: n.id,
            average_rating: n.average_rating ?? null,
            date: n.revealed_at ?? n.created_at,
            participant_user_ids: participantUserIds,
        });
    }

    // ── Build tiles ───────────────────────────────────────────────────────────
    const tiles: RestaurantTile[] = [];
    const restaurantList = [...restaurantMap.values()];

    // Unique member count for city stats
    const cityMemberIds = new Set<string>();

    for (const agg of restaurantList) {
        const hasRound = agg.round_visits.length > 0;
        const hasSolo = agg.solo_visits.length > 0;
        const tile_type: 'solo' | 'round' | 'mixed' = hasRound
            ? hasSolo
                ? 'mixed'
                : 'round'
            : 'solo';

        // Rating derivation
        let rating: number | null = null;
        if (hasRound) {
            // Round or mixed: use the most-recent Round's average_rating
            const latestRound = agg.round_visits.sort((a, b) =>
                b.date.localeCompare(a.date),
            )[0];
            rating = latestRound.average_rating;
        } else {
            // Solo: viewer's personal avg, else most-recent solo rating
            const viewerSolos = agg.solo_visits.filter(
                (v) => v.user_id === userId,
            );
            if (viewerSolos.length > 0) {
                const ratedSolos = viewerSolos.filter((v) => v.rating != null);
                if (ratedSolos.length > 0) {
                    rating =
                        ratedSolos.reduce((sum, v) => sum + v.rating!, 0) /
                        ratedSolos.length;
                }
            }
            if (rating == null) {
                const sorted = agg.solo_visits
                    .filter((v) => v.rating != null)
                    .sort((a, b) => b.date.localeCompare(a.date));
                if (sorted.length > 0) rating = sorted[0].rating;
            }
        }

        // Collect unique member IDs
        const memberIdsSet = new Set<string>();
        for (const rv of agg.round_visits) {
            for (const uid of rv.participant_user_ids) {
                memberIdsSet.add(uid);
                cityMemberIds.add(uid);
            }
        }
        for (const sv of agg.solo_visits) {
            memberIdsSet.add(sv.user_id);
            cityMemberIds.add(sv.user_id);
        }

        const memberIds = [...memberIdsSet];
        const memberNames = memberIds.map(
            (id) => profiles.get(id)?.display_name ?? 'Member',
        );
        const memberAvatarUrls = memberIds.map(
            (id) => profiles.get(id)?.avatar_url ?? null,
        );

        // Build visit list (rounds first, then solos, newest first)
        const visits: VisitRow[] = [
            ...agg.round_visits
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((rv) => ({
                    kind: 'round' as const,
                    id: rv.night_id,
                    user_id: rv.participant_user_ids[0] ?? '',
                    display_name:
                        profiles.get(rv.participant_user_ids[0] ?? '')
                            ?.display_name ?? 'Tablemate',
                    avatar_url:
                        profiles.get(rv.participant_user_ids[0] ?? '')
                            ?.avatar_url ?? null,
                    rating: rv.average_rating,
                    date: rv.date,
                    table_night_id: rv.night_id,
                })),
            ...agg.solo_visits
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((sv) => ({
                    kind: 'solo' as const,
                    id: sv.entry_id,
                    user_id: sv.user_id,
                    display_name:
                        profiles.get(sv.user_id)?.display_name ?? 'Member',
                    avatar_url:
                        profiles.get(sv.user_id)?.avatar_url ?? null,
                    rating: sv.rating,
                    date: sv.date,
                    entry_id: sv.entry_id,
                })),
        ];

        tiles.push({
            id: agg.id,
            name: agg.name,
            cuisine: agg.cuisine,
            photo_url: agg.photo_url,
            lat: agg.lat,
            lng: agg.lng,
            rating: rating != null ? Math.round(rating * 10) / 10 : null,
            tile_type,
            wished_by_viewer: wishedIds.has(agg.id),
            companion_ids: [...agg.companion_ids_union],
            visits,
            round_count: agg.round_visits.length,
            solo_count: agg.solo_visits.length,
            member_ids: memberIds,
            member_names: memberNames,
            member_avatar_urls: memberAvatarUrls,
        });
    }

    // Sort by most-recent visit date DESC (default)
    tiles.sort((a, b) => {
        const aDate =
            a.visits[0]?.date ?? '1970-01-01';
        const bDate =
            b.visits[0]?.date ?? '1970-01-01';
        return bDate.localeCompare(aDate);
    });

    const cityStats: CityStats = {
        city,
        spot_count: tiles.length,
        member_count: cityMemberIds.size,
    };

    const response: CityPageResponse = {
        city,
        city_stats: cityStats,
        restaurants: tiles,
    };
    return json({ data: response });
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!authHeader) return fail('Missing Authorization header', 401);

        const token = authHeader.replace('Bearer ', '');
        const supabase = createClient(supabaseUrl ?? '', supabaseServiceKey ?? '');

        const {
            data: { user },
            error: userError,
        } = await supabase.auth.getUser(token);
        if (userError || !user) return fail('Unauthorized', 401);

        if (req.method !== 'POST') return fail('Method not allowed', 405);

        const body = await req.json();
        const { action, table_id, city } = body as {
            action?: string;
            table_id?: string;
            city?: string;
        };

        if (!table_id) return fail('table_id is required', 400);

        // Verify membership
        const isMember = await checkMembership(supabase, user.id, table_id);
        if (!isMember) return fail('Forbidden', 403);

        if (action === 'city-index') {
            return await handleCityIndex(supabase, user.id, table_id);
        }

        if (action === 'city-page') {
            if (!city) return fail('city is required for city-page action', 400);
            return await handleCityPage(supabase, user.id, table_id, city);
        }

        return fail(`Unknown action: ${action}`, 400);
    } catch (err) {
        console.error('table-atlas error:', err);
        return json({ error: String(err) }, 500);
    }
});
