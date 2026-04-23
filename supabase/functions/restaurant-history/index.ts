/**
 * Restaurant History Edge Function
 *
 * Returns the Table's (or a user's) accumulated memory at a given restaurant:
 * previous Rounds, previous solo entries, and aggregate averages.
 *
 * This powers:
 *   - "Previously here" banner on Round detail (table-scoped)
 *   - Delta chip on Round hero (previous group average vs current)
 *   - "Previously here" banner on Entry detail (user-scoped, cross-table)
 *   - /restaurant/[id] screen (table-scoped list of all visits)
 *
 * Actions:
 *   GET  ?action=table_history&restaurant_id=X&table_id=Y[&exclude_night_id=Z]
 *   GET  ?action=user_history&restaurant_id=X[&exclude_entry_id=Z]
 *   GET  ?action=page&restaurant_id=X[&table_id=Y]
 *
 * Both filter to data the requesting user is entitled to see. Table history
 * verifies the caller is a member of the table; user history is trivially
 * scoped to the caller's own entries.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { computeCalibrations, type Calibration } from '../_shared/calibration.ts';

type Visit = {
    kind: 'round' | 'solo';
    id: string; // table_night_id for rounds, entry_id for solos
    rating: number | null;
    date: string; // ISO
    user_display_names: string[]; // participants (rounds) or single author (solo)
    entry_id?: string; // for solos — convenient for navigation
    table_night_id?: string; // for rounds
    // Extended fields for action=page
    user_id?: string;
    avatar_url?: string | null;
    note?: string | null;
    is_self?: boolean;
    is_tablemate?: boolean;
};

type WhosBeenEntry = {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    personal_average: number;
    visit_count: number;
};

type PublicReviewCard = {
    entry_id: string;
    user_id: string;
    display_name: string;
    username: string | null;
    avatar_url: string | null;
    rating: number;
    note_excerpt: string;
    photo_url: string | null;
    created_at: string;
    public_reaction_count: number;
    public_reply_count: number;
    calibration: Calibration | null;
};

type PhotoItem = {
    url: string;
    author_display_name: string;
    author_handle: string;
    is_tablemate: boolean;
    is_self: boolean;
    entry_id: string;
};

type PlaceDetails = {
    hours_today: string | null;
    open_now: boolean | null;
    hours_week: Array<{ day_range: string; range: string }> | null;
    website: string | null;
    phone: string | null;
    menu_url: string | null;
    lat: number | null;
    lng: number | null;
};

type RestaurantPageData = {
    restaurant: {
        id: string;
        name: string;
        address: string | null;
        city: string | null;
        country: string | null;
        cuisine: string | null;
        price_level: number | null;
        photo_url: string | null;
        google_rating: number | null;
        google_rating_count: number | null;
        external_id: string | null;
    } | null;
    personal: { average: number | null; visit_count: number };
    table_chip: { table_id: string; table_name: string; average: number; visit_count: number } | null;
    whos_been: WhosBeenEntry[];
    visits: Visit[];
    visit_count: number;
    public_reviews: PublicReviewCard[];
    public_reviews_total: number;
    // v3 additions
    distributions: {
        you: number[];
        your_table: number[] | null;
        napkin: number[];
    };
    napkin_aggregate: {
        average: number | null;
        count: number;
    };
    photos: {
        from_your_table: PhotoItem[];
        from_others: PhotoItem[];
    };
    place_details: PlaceDetails;
    tables_count_with_logs: number;
    first_logged_at_by_your_table: string | null;
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function fail(message: string, status = 400): Response {
    return json({ error: message }, status);
}

async function fetchProfiles(
    supabase: any,
    userIds: string[],
): Promise<Map<string, { display_name: string; avatar_url: string | null; username: string | null }>> {
    const map = new Map<string, { display_name: string; avatar_url: string | null; username: string | null }>();
    if (userIds.length === 0) return map;
    const unique = [...new Set(userIds)];
    const { data, error } = await supabase
        .from('profiles')
        .select('user_id, display_name, avatar_url, username')
        .in('user_id', unique);
    if (error) throw error;
    for (const p of (data ?? []) as any[]) {
        map.set(p.user_id, {
            display_name: p.display_name ?? 'Member',
            avatar_url: p.avatar_url ?? null,
            username: p.username ?? null,
        });
    }
    return map;
}

/** Build a 5-element distribution array [1★ count, 2★ count, 3★ count, 4★ count, 5★ count] */
function buildDistribution(ratings: number[]): number[] {
    const dist = [0, 0, 0, 0, 0];
    for (const r of ratings) {
        const bucket = Math.round(Math.max(1, Math.min(5, r))) - 1;
        dist[bucket]++;
    }
    return dist;
}

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

        const url = new URL(req.url);
        const action = url.searchParams.get('action');
        const restaurantId = url.searchParams.get('restaurant_id');

        if (req.method !== 'GET') return fail('Method not allowed', 405);

        // ── Restaurant search ─────────────────────────────────────────────
        if (action === 'search') {
            const q = url.searchParams.get('q')?.trim();
            if (!q || q.length < 2) return fail('q must be at least 2 characters', 400);

            const { data: memberships, error: memberErr } = await supabase
                .from('table_members')
                .select('table_id, tables(id, name)')
                .eq('member_id', user.id);
            if (memberErr) throw memberErr;

            const tableIds = (memberships ?? []).map((m: any) => m.table_id as string);

            let visitedRestaurants: any[] = [];
            if (tableIds.length > 0) {
                const { data: entryRestaurants, error: entryErr } = await supabase
                    .from('entries')
                    .select('restaurant_id, table_id, created_at, tables(name)')
                    .in('table_id', tableIds)
                    .not('restaurant_id', 'is', null)
                    .order('created_at', { ascending: false });
                if (entryErr) throw entryErr;

                const { data: nightRestaurants, error: nightErr } = await supabase
                    .from('table_nights')
                    .select('restaurant_id, table_id, created_at, tables(name)')
                    .in('table_id', tableIds)
                    .eq('status', 'revealed')
                    .not('restaurant_id', 'is', null)
                    .order('created_at', { ascending: false });
                if (nightErr) throw nightErr;

                const restaurantTableMap = new Map<string, { table_name: string; most_recent_activity_at: string }>();
                for (const e of (entryRestaurants ?? [])) {
                    const rid = e.restaurant_id as string;
                    const tableName = (e as any).tables?.name as string ?? 'your Table';
                    const existing = restaurantTableMap.get(rid);
                    if (!existing || e.created_at > existing.most_recent_activity_at) {
                        restaurantTableMap.set(rid, { table_name: tableName, most_recent_activity_at: e.created_at });
                    }
                }
                for (const n of (nightRestaurants ?? [])) {
                    const rid = n.restaurant_id as string;
                    const tableName = (n as any).tables?.name as string ?? 'your Table';
                    const existing = restaurantTableMap.get(rid);
                    if (!existing || n.created_at > existing.most_recent_activity_at) {
                        restaurantTableMap.set(rid, { table_name: tableName, most_recent_activity_at: n.created_at });
                    }
                }

                if (restaurantTableMap.size > 0) {
                    const visitedIds = Array.from(restaurantTableMap.keys());
                    const { data: restaurants, error: restErr } = await supabase
                        .from('restaurants')
                        .select('id, name, city, cuisine, photo_url, external_id')
                        .in('id', visitedIds)
                        .ilike('name', `%${q}%`)
                        .limit(10);
                    if (restErr) throw restErr;

                    visitedRestaurants = (restaurants ?? []).map((r: any) => ({
                        ...r,
                        table_name: restaurantTableMap.get(r.id)?.table_name ?? 'your Table',
                        most_recent_activity_at: restaurantTableMap.get(r.id)?.most_recent_activity_at ?? null,
                    }));
                }
            }

            const visitedIds = visitedRestaurants.map((r: any) => r.id as string);
            let onNapkinQuery = supabase
                .from('restaurants')
                .select('id, name, city, cuisine, photo_url, external_id')
                .ilike('name', `%${q}%`)
                .limit(20);
            if (visitedIds.length > 0) {
                onNapkinQuery = onNapkinQuery.not('id', 'in', `(${visitedIds.join(',')})`);
            }
            const { data: onNapkin, error: onNapkinErr } = await onNapkinQuery;
            if (onNapkinErr) throw onNapkinErr;

            return json({
                data: {
                    visitedByMyTables: visitedRestaurants,
                    onNapkin: (onNapkin ?? []).slice(0, 10),
                },
            });
        }

        if (!restaurantId) return fail('restaurant_id is required', 400);

        // ── Table-scoped history ──────────────────────────────────────────
        if (action === 'table_history') {
            const tableId = url.searchParams.get('table_id');
            const excludeNightId = url.searchParams.get('exclude_night_id');

            if (!tableId) return fail('table_id is required for table_history', 400);

            const { data: membership, error: memberErr } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', tableId)
                .eq('member_id', user.id)
                .maybeSingle();
            if (memberErr) throw memberErr;
            if (!membership) return fail('Not a member of this table', 403);

            const { data: restaurant, error: restErr } = await supabase
                .from('restaurants')
                .select('id, name, address, city, country, photo_url')
                .eq('id', restaurantId)
                .maybeSingle();
            if (restErr) throw restErr;

            let roundsQuery = supabase
                .from('table_nights')
                .select(`
                    id,
                    status,
                    revealed_at,
                    created_at,
                    table_night_participants (
                        rating,
                        profiles ( display_name )
                    )
                `)
                .eq('table_id', tableId)
                .eq('restaurant_id', restaurantId)
                .eq('status', 'revealed');
            if (excludeNightId) roundsQuery = roundsQuery.neq('id', excludeNightId);

            const { data: rounds, error: roundsErr } = await roundsQuery;
            if (roundsErr) throw roundsErr;

            const { data: soloEntries, error: entriesErr } = await supabase
                .from('entries')
                .select(`
                    id,
                    rating,
                    visited_at,
                    created_at,
                    user_id
                `)
                .eq('table_id', tableId)
                .eq('restaurant_id', restaurantId)
                .is('table_night_id', null)
                .not('rating', 'is', null)
                .order('visited_at', { ascending: false });
            if (entriesErr) throw entriesErr;

            const visits: Visit[] = [];

            for (const r of rounds ?? []) {
                const participants = (r.table_night_participants ?? []) as any[];
                const ratings = participants
                    .map((p) => p.rating)
                    .filter((x) => typeof x === 'number') as number[];
                const avg =
                    ratings.length > 0
                        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
                        : null;
                const names = participants
                    .map((p) => p.profiles?.display_name)
                    .filter(Boolean) as string[];
                visits.push({
                    kind: 'round',
                    id: r.id,
                    table_night_id: r.id,
                    rating: avg,
                    date: r.revealed_at ?? r.created_at,
                    user_display_names: names,
                });
            }

            for (const e of soloEntries ?? []) {
                const name = (e as any).profiles?.display_name as string | undefined;
                visits.push({
                    kind: 'solo',
                    id: e.id,
                    entry_id: e.id,
                    rating: e.rating,
                    date: (e.visited_at ?? e.created_at) as string,
                    user_display_names: name ? [name] : [],
                });
            }

            visits.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

            const ratedVisits = visits.filter((v) => v.rating != null);
            const tableAverage =
                ratedVisits.length > 0
                    ? ratedVisits.reduce((sum, v) => sum + (v.rating as number), 0) /
                      ratedVisits.length
                    : null;

            return json({
                data: {
                    restaurant,
                    visits,
                    visit_count: visits.length,
                    table_average: tableAverage,
                    last_visit: visits[0] ?? null,
                },
            });
        }

        // ── User-scoped history (cross-table) ──────────────────────────────
        if (action === 'user_history') {
            const excludeEntryId = url.searchParams.get('exclude_entry_id');

            let q = supabase
                .from('entries')
                .select(`
                    id,
                    rating,
                    visited_at,
                    created_at,
                    table_night_id,
                    table_id
                `)
                .eq('user_id', user.id)
                .eq('restaurant_id', restaurantId)
                .not('rating', 'is', null)
                .order('visited_at', { ascending: false });
            if (excludeEntryId) q = q.neq('id', excludeEntryId);

            const { data: entries, error } = await q;
            if (error) throw error;

            const visits: Visit[] = (entries ?? []).map((e: any) => ({
                kind: e.table_night_id ? 'round' : 'solo',
                id: e.id,
                entry_id: e.id,
                table_night_id: e.table_night_id ?? undefined,
                rating: e.rating,
                date: (e.visited_at ?? e.created_at) as string,
                user_display_names: [],
            }));

            const ratedVisits = visits.filter((v) => v.rating != null);
            const userAverage =
                ratedVisits.length > 0
                    ? ratedVisits.reduce((sum, v) => sum + (v.rating as number), 0) /
                      ratedVisits.length
                    : null;

            return json({
                data: {
                    visits,
                    visit_count: visits.length,
                    user_average: userAverage,
                    last_visit: visits[0] ?? null,
                },
            });
        }

        // ── Full restaurant page data (aggregated) — v3 ───────────────────────────
        if (action === 'page') {
            const tableIdParam = url.searchParams.get('table_id');

            // Resolve restaurant — UUID takes precedence; fall back to external_id
            const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const isUuid = uuidPattern.test(restaurantId);

            let restaurantRow: RestaurantPageData['restaurant'] = null;
            if (isUuid) {
                const { data, error } = await supabase
                    .from('restaurants')
                    .select('id, name, address, city, country, cuisine, price_level, photo_url, google_rating, google_rating_count, external_id, lat, lng')
                    .eq('id', restaurantId)
                    .maybeSingle();
                if (error) throw error;
                restaurantRow = data ?? null;
            } else {
                const { data, error } = await supabase
                    .from('restaurants')
                    .select('id, name, address, city, country, cuisine, price_level, photo_url, google_rating, google_rating_count, external_id, lat, lng')
                    .eq('external_id', restaurantId)
                    .maybeSingle();
                if (error) throw error;
                restaurantRow = data ?? null;
            }

            // Empty page for ghost restaurants not yet in DB
            const emptyDistributions = { you: [0,0,0,0,0], your_table: null, napkin: [0,0,0,0,0] };
            const emptyPhotos = { from_your_table: [], from_others: [] };
            const emptyPlaceDetails: PlaceDetails = { hours_today: null, open_now: null, hours_week: null, website: null, phone: null, menu_url: null, lat: null, lng: null };

            if (!restaurantRow) {
                return json({
                    data: {
                        restaurant: null,
                        personal: { average: null, visit_count: 0 },
                        table_chip: null,
                        whos_been: [],
                        visits: [],
                        visit_count: 0,
                        public_reviews: [],
                        public_reviews_total: 0,
                        distributions: emptyDistributions,
                        napkin_aggregate: { average: null, count: 0 },
                        photos: emptyPhotos,
                        place_details: emptyPlaceDetails,
                        tables_count_with_logs: 0,
                        first_logged_at_by_your_table: null,
                    } as RestaurantPageData,
                });
            }

            const resolvedRestaurantId = restaurantRow.id;

            // Best-effort place_details from cached DB columns
            const placeDetails: PlaceDetails = {
                hours_today: null,
                open_now: null,
                hours_week: null,
                website: null,
                phone: null,
                menu_url: null,
                lat: (restaurantRow as any).lat ?? null,
                lng: (restaurantRow as any).lng ?? null,
            };

            // Find all table_ids the user is a member of
            const { data: memberships, error: memberErr } = await supabase
                .from('table_members')
                .select('table_id, tables(id, name)')
                .eq('member_id', user.id);
            if (memberErr) throw memberErr;

            const memberTableIds = (memberships ?? []).map((m: any) => m.table_id as string);

            // ── Personal average (viewer's own entries across all Tables) ──
            let personalAverage: number | null = null;
            let personalVisitCount = 0;
            let personalRatings: number[] = [];
            let personalLastVisit: { date: string; rating: number | null } | null = null;

            {
                const { data: personalEntries, error: personalErr } = await supabase
                    .from('entries')
                    .select('id, rating, visited_at, created_at')
                    .eq('user_id', user.id)
                    .eq('restaurant_id', resolvedRestaurantId)
                    .not('rating', 'is', null)
                    .order('visited_at', { ascending: false });
                if (personalErr) throw personalErr;

                const rated = (personalEntries ?? []).filter((e: any) => e.rating != null);
                personalVisitCount = rated.length;
                if (rated.length > 0) {
                    personalRatings = rated.map((e: any) => e.rating as number);
                    personalAverage = personalRatings.reduce((a, b) => a + b, 0) / personalRatings.length;
                    personalLastVisit = {
                        date: (rated[0].visited_at ?? rated[0].created_at) as string,
                        rating: rated[0].rating ?? null,
                    };
                }
            }

            // ── Table chip — most recent visit's Table, biased by tableId param ──
            let tableChip: RestaurantPageData['table_chip'] = null;
            let tableRatings: number[] = [];
            let tableVisitorIds: Set<string> = new Set();

            if (memberTableIds.length > 0) {
                let candidateTableIds = memberTableIds;
                if (tableIdParam && memberTableIds.includes(tableIdParam)) {
                    candidateTableIds = [tableIdParam];
                }

                const { data: tableEntries, error: tableEntriesErr } = await supabase
                    .from('entries')
                    .select('id, rating, table_id, user_id, visited_at, created_at, tables(id, name)')
                    .in('table_id', candidateTableIds)
                    .eq('restaurant_id', resolvedRestaurantId)
                    .not('rating', 'is', null)
                    .order('visited_at', { ascending: false });
                if (tableEntriesErr) throw tableEntriesErr;

                if ((tableEntries ?? []).length > 0) {
                    const mostRecentEntry = (tableEntries as any[])[0];
                    const chipTableId = mostRecentEntry.table_id as string;
                    const chipTableName = mostRecentEntry.tables?.name as string ?? 'Table';

                    const chipEntries = (tableEntries as any[]).filter(e => e.table_id === chipTableId);
                    tableRatings = chipEntries.map((e: any) => e.rating as number);
                    chipEntries.forEach((e: any) => tableVisitorIds.add(e.user_id as string));
                    const chipAvg = tableRatings.reduce((sum, r) => sum + r, 0) / tableRatings.length;

                    tableChip = {
                        table_id: chipTableId,
                        table_name: chipTableName,
                        average: chipAvg,
                        visit_count: chipEntries.length,
                    };
                }
            }

            // ── Shared-Table members ──
            let sharedUserIds: string[] = [];
            if (memberTableIds.length > 0) {
                const { data: sharedMembers, error: sharedErr } = await supabase
                    .from('table_members')
                    .select('member_id')
                    .in('table_id', memberTableIds)
                    .neq('member_id', user.id);
                if (sharedErr) throw sharedErr;
                sharedUserIds = [...new Set((sharedMembers ?? []).map((m: any) => m.member_id as string))];
            }

            // ── Who's been ──
            let whosBeen: WhosBeenEntry[] = [];
            if (sharedUserIds.length > 0) {
                const { data: sharedEntries, error: sharedEntriesErr } = await supabase
                    .from('entries')
                    .select('user_id, rating')
                    .in('user_id', sharedUserIds)
                    .eq('restaurant_id', resolvedRestaurantId)
                    .not('rating', 'is', null);
                if (sharedEntriesErr) throw sharedEntriesErr;

                const sharedProfiles = await fetchProfiles(supabase, sharedUserIds);

                const byUser = new Map<string, { display_name: string; avatar_url: string | null; username: string | null; ratings: number[] }>();
                for (const e of (sharedEntries ?? []) as any[]) {
                    const uid = e.user_id as string;
                    const prof = sharedProfiles.get(uid);
                    if (!byUser.has(uid)) {
                        byUser.set(uid, {
                            display_name: prof?.display_name ?? 'Member',
                            avatar_url: prof?.avatar_url ?? null,
                            username: prof?.username ?? null,
                            ratings: [],
                        });
                    }
                    if (e.rating != null) {
                        byUser.get(uid)!.ratings.push(e.rating as number);
                    }
                }

                whosBeen = Array.from(byUser.entries()).map(([uid, info]) => ({
                    user_id: uid,
                    display_name: info.display_name,
                    avatar_url: info.avatar_url,
                    personal_average: info.ratings.reduce((a, b) => a + b, 0) / info.ratings.length,
                    visit_count: info.ratings.length,
                }));
            }

            // ── Visits feed — viewer's own entries (always) + shared users' entries (when has tables) ──
            // Individual-first doctrine: a solo user with no tables must still see their own Visits.
            // The guard here is only on the tablemate/rounds branches, not on the self-entries fetch.
            const allVisibleUserIds = [user.id, ...sharedUserIds];
            const visitsRaw: Visit[] = [];

            {
                // Always fetch the viewer's own entries — regardless of table membership.
                // For users with tables, also fetch tablemates' entries in the same query.
                const { data: feedEntries, error: feedEntriesErr } = await supabase
                    .from('entries')
                    .select('id, user_id, rating, visited_at, created_at, content, table_night_id')
                    .in('user_id', allVisibleUserIds)
                    .eq('restaurant_id', resolvedRestaurantId)
                    .is('table_night_id', null)
                    .not('rating', 'is', null)
                    .order('visited_at', { ascending: false });
                if (feedEntriesErr) throw feedEntriesErr;

                const feedProfiles = await fetchProfiles(supabase, (feedEntries ?? []).map((e: any) => e.user_id as string));

                for (const e of (feedEntries ?? []) as any[]) {
                    const prof = feedProfiles.get(e.user_id);
                    visitsRaw.push({
                        kind: 'solo',
                        id: e.id,
                        entry_id: e.id,
                        user_id: e.user_id,
                        avatar_url: prof?.avatar_url ?? null,
                        rating: e.rating,
                        date: e.visited_at ?? e.created_at,
                        user_display_names: prof?.display_name ? [prof.display_name] : [],
                        note: e.content ?? null,
                        is_self: e.user_id === user.id,
                        is_tablemate: sharedUserIds.includes(e.user_id),
                    });
                }
            }

            // Rounds are table-scoped — only fetch when the user has table membership.
            if (memberTableIds.length > 0) {
                const { data: feedNights, error: feedNightsErr } = await supabase
                    .from('table_nights')
                    .select(`
                        id,
                        host_user_id,
                        revealed_at,
                        created_at,
                        table_night_participants(
                            user_id,
                            rating,
                            notes,
                            profiles(display_name, avatar_url)
                        )
                    `)
                    .in('table_id', memberTableIds)
                    .eq('restaurant_id', resolvedRestaurantId)
                    .eq('status', 'revealed');
                if (feedNightsErr) throw feedNightsErr;

                for (const night of (feedNights ?? []) as any[]) {
                    const participants = (night.table_night_participants ?? []) as any[];
                    const visibleParticipants = participants.filter((p: any) =>
                        allVisibleUserIds.includes(p.user_id)
                    );
                    if (visibleParticipants.length === 0) continue;

                    const ratings = participants
                        .map((p: any) => p.rating)
                        .filter((r: any) => r != null) as number[];
                    const avg = ratings.length > 0
                        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
                        : null;
                    const names = participants
                        .map((p: any) => p.profiles?.display_name)
                        .filter(Boolean) as string[];

                    visitsRaw.push({
                        kind: 'round',
                        id: night.id,
                        table_night_id: night.id,
                        user_id: night.host_user_id,
                        avatar_url: null,
                        rating: avg,
                        date: night.revealed_at ?? night.created_at,
                        user_display_names: names,
                        note: null,
                        is_self: night.host_user_id === user.id,
                        is_tablemate: sharedUserIds.includes(night.host_user_id),
                    });
                }
            }

            visitsRaw.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

            // ── Public reviews ──
            const { data: publicReviewRows, error: publicReviewsErr } = await supabase
                .rpc('get_public_reviews', {
                    p_restaurant_id: resolvedRestaurantId,
                    p_limit: 20,
                });
            if (publicReviewsErr) throw publicReviewsErr;

            const publicReviewsTotal: number = publicReviewRows?.length > 0
                ? Number((publicReviewRows[0] as any).total_count ?? 0)
                : 0;

            // ── Calibration batch for public review authors ──
            // Filter out the viewer and Tablemates — calibration is Ring 2 only.
            // The helper defends against Tablemates internally, but we pre-filter
            // here for performance (avoids passing known Tablemates to the helper).
            const allSharedMemberIds = new Set<string>(sharedUserIds);
            const publicReviewAuthorIds: string[] = [...new Set<string>(
                (publicReviewRows ?? [])
                    .map((row: any) => row.user_id as string)
                    .filter((uid: string) => uid !== user.id && !allSharedMemberIds.has(uid))
            )];

            let calMap = new Map<string, Calibration | null>();
            if (publicReviewAuthorIds.length > 0) {
                try {
                    calMap = await computeCalibrations(supabase, user.id, publicReviewAuthorIds);
                } catch (calErr) {
                    // Non-fatal: calibration failure should not degrade the page
                    console.error('restaurant-history calibration error:', calErr);
                }
            }

            const publicReviews: PublicReviewCard[] = ((publicReviewRows ?? []) as any[]).map((row: any) => ({
                entry_id: row.entry_id,
                user_id: row.user_id,
                display_name: row.display_name ?? 'User',
                username: row.username ?? null,
                avatar_url: row.avatar_url ?? null,
                rating: row.rating,
                note_excerpt: row.content ?? '',
                photo_url: row.photo_url ?? null,
                created_at: row.created_at,
                public_reaction_count: row.public_reaction_count ?? 0,
                public_reply_count: row.public_reply_count ?? 0,
                // calibration is null for viewer's own reviews and Tablemates (Ring 1)
                calibration: (row.user_id === user.id || allSharedMemberIds.has(row.user_id))
                    ? null
                    : (calMap.get(row.user_id) ?? null),
            }));

            // ── v3: Distributions ──
            // "you" distribution
            const youDist = buildDistribution(personalRatings);

            // "your_table" distribution — all entries from the chip table
            const yourTableDist: number[] | null = tableChip ? buildDistribution(tableRatings) : null;

            // "napkin" distribution — all public entries at this restaurant
            let napkinRatings: number[] = [];
            {
                const { data: napkinEntries, error: napkinErr } = await supabase
                    .from('entries')
                    .select('rating')
                    .eq('restaurant_id', resolvedRestaurantId)
                    .not('rating', 'is', null);
                if (!napkinErr) {
                    napkinRatings = (napkinEntries ?? []).map((e: any) => e.rating as number);
                }
            }
            const napkinDist = buildDistribution(napkinRatings);
            const napkinAverage = napkinRatings.length > 0
                ? napkinRatings.reduce((a, b) => a + b, 0) / napkinRatings.length
                : null;
            const napkinCount = napkinRatings.length;

            // ── v3: Photos ──
            let fromYourTable: PhotoItem[] = [];
            let fromOthers: PhotoItem[] = [];

            {
                // Fetch entry_photos filtered server-side by restaurant_id via the entries join.
                // The inner join ensures only photos whose entry is at this restaurant are returned,
                // so the subsequent limit(48) is applied after the restaurant filter — not before it.
                // ARCHITECT-REVIEW: adding restaurant_id directly to entry_photos would allow a
                // simpler indexed query; for now the inner join on entries is correct and sufficient.
                const { data: entryPhotoRows, error: photoErr } = await supabase
                    .from('entry_photos')
                    .select('photo_url, entry_id, entries!inner(user_id, restaurant_id, table_id)')
                    .eq('entries.restaurant_id', resolvedRestaurantId)
                    .not('photo_url', 'is', null)
                    .limit(48);

                if (photoErr) {
                    console.error('restaurant-history photos error:', photoErr.message);
                }

                if (!photoErr && entryPhotoRows) {
                    // All rows are already filtered to this restaurant by the server-side join.
                    const relevantPhotos = entryPhotoRows as any[];

                    // Collect all user IDs to fetch profiles
                    const photoUserIds = [...new Set(relevantPhotos.map((p: any) => p.entries?.user_id as string).filter(Boolean))];
                    const photoProfiles = await fetchProfiles(supabase, photoUserIds);

                    for (const photo of relevantPhotos) {
                        const userId = photo.entries?.user_id as string;
                        const entryTableId = photo.entries?.table_id as string | null;
                        const prof = photoProfiles.get(userId);
                        const photoUrl = photo.photo_url ?? null;
                        if (!photoUrl) continue;

                        const isSelf = userId === user.id;
                        const isTablemate = sharedUserIds.includes(userId);

                        const item: PhotoItem = {
                            url: photoUrl,
                            author_display_name: prof?.display_name ?? 'User',
                            author_handle: prof?.username ? `@${prof.username}` : '@user',
                            is_tablemate: isTablemate,
                            is_self: isSelf,
                            entry_id: photo.entry_id,
                        };

                        // Trust ring: the viewer's own photos always go to fromYourTable.
                        // A tablemate's photo only goes to fromYourTable when the source entry
                        // was actually shared to a table the viewer is also in (table_id IS NOT NULL
                        // AND that table_id is in the viewer's memberTableIds).
                        // Feed-only (table_id = null) entries from tablemates stay in fromOthers.
                        const isSharedToSharedTable =
                            entryTableId != null && memberTableIds.includes(entryTableId);

                        if (isSelf || isSharedToSharedTable) {
                            fromYourTable.push(item);
                        } else {
                            fromOthers.push(item);
                        }
                    }

                    // Sort: self first, then tablemates
                    fromYourTable.sort((a, b) => {
                        if (a.is_self && !b.is_self) return -1;
                        if (!a.is_self && b.is_self) return 1;
                        return 0;
                    });

                    // Cap at 24
                    fromYourTable = fromYourTable.slice(0, 24);
                    fromOthers = fromOthers.slice(0, 24);
                }
            }

            // ── v3: tables_count_with_logs + first_logged_at_by_your_table ──
            let tablesCountWithLogs = 0;
            let firstLoggedAtByYourTable: string | null = null;

            if (memberTableIds.length > 0) {
                // Count distinct tables that have entries at this restaurant
                const { data: loggedTables, error: loggedTablesErr } = await supabase
                    .from('entries')
                    .select('table_id, visited_at, created_at')
                    .in('table_id', memberTableIds)
                    .eq('restaurant_id', resolvedRestaurantId)
                    .not('table_id', 'is', null);
                if (!loggedTablesErr && loggedTables) {
                    const distinctTableIds = new Set((loggedTables as any[]).map((e: any) => e.table_id as string));
                    tablesCountWithLogs = distinctTableIds.size;

                    // Earliest entry date
                    const allDates = (loggedTables as any[]).map((e: any) => (e.visited_at ?? e.created_at) as string);
                    if (allDates.length > 0) {
                        firstLoggedAtByYourTable = allDates.sort()[0];
                    }
                }
            }

            // Napkin average and count for the signal strip
            // (napkinAverage and napkinCount computed above from all entries)

            return json({
                data: {
                    restaurant: restaurantRow,
                    personal: { average: personalAverage, visit_count: personalVisitCount, last_visit: personalLastVisit },
                    table_chip: tableChip
                        ? {
                            ...tableChip,
                            member_count: tableVisitorIds.size,
                        }
                        : null,
                    whos_been: whosBeen,
                    visits: visitsRaw,
                    visit_count: visitsRaw.length,
                    public_reviews: publicReviews,
                    public_reviews_total: publicReviewsTotal,
                    distributions: {
                        you: youDist,
                        your_table: yourTableDist,
                        napkin: napkinDist,
                    },
                    napkin_aggregate: {
                        average: napkinAverage,
                        count: napkinCount,
                    },
                    photos: {
                        from_your_table: fromYourTable,
                        from_others: fromOthers,
                    },
                    place_details: placeDetails,
                    tables_count_with_logs: tablesCountWithLogs,
                    first_logged_at_by_your_table: firstLoggedAtByYourTable,
                } as RestaurantPageData,
            });
        }

        return fail('Unknown action', 400);
    } catch (err) {
        const msg = err instanceof Error ? err.message : JSON.stringify(err);
        console.error('restaurant-history error:', msg, err);
        return json(
            { error: 'Internal Server Error', details: msg },
            500,
        );
    }
});
