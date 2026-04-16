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
 *
 * Both filter to data the requesting user is entitled to see. Table history
 * verifies the caller is a member of the table; user history is trivially
 * scoped to the caller's own entries.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

type Visit = {
    kind: 'round' | 'solo';
    id: string; // table_night_id for rounds, entry_id for solos
    rating: number | null;
    date: string; // ISO
    user_display_names: string[]; // participants (rounds) or single author (solo)
    entry_id?: string; // for solos — convenient for navigation
    table_night_id?: string; // for rounds
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
        // action=search&q=...
        // Returns two arrays:
        //   visitedByMyTables: restaurants your Tables have logged (with table_name, most_recent_activity_at)
        //   onNapkin: other persisted restaurants matching the query
        // external_id is where Google Place IDs are stored (renamed from google_place_id in 20251215134700)
        if (action === 'search') {
            const q = url.searchParams.get('q')?.trim();
            if (!q || q.length < 2) return fail('q must be at least 2 characters', 400);

            // Find all table_ids the user is a member of
            const { data: memberships, error: memberErr } = await supabase
                .from('table_members')
                .select('table_id, tables(id, name)')
                .eq('member_id', user.id);
            if (memberErr) throw memberErr;

            const tableIds = (memberships ?? []).map((m: any) => m.table_id as string);

            // Tier 1: restaurants persisted in Napkin AND logged by user's Tables
            // Join through entries or table_nights to find restaurants the user's tables have visited
            let visitedRestaurants: any[] = [];
            if (tableIds.length > 0) {
                // Get restaurant IDs that have entries in user's tables
                const { data: entryRestaurants, error: entryErr } = await supabase
                    .from('entries')
                    .select('restaurant_id, table_id, created_at, tables(name)')
                    .in('table_id', tableIds)
                    .not('restaurant_id', 'is', null)
                    .order('created_at', { ascending: false });
                if (entryErr) throw entryErr;

                // Get restaurant IDs that have table_nights in user's tables
                const { data: nightRestaurants, error: nightErr } = await supabase
                    .from('table_nights')
                    .select('restaurant_id, table_id, created_at, tables(name)')
                    .in('table_id', tableIds)
                    .eq('status', 'revealed')
                    .not('restaurant_id', 'is', null)
                    .order('created_at', { ascending: false });
                if (nightErr) throw nightErr;

                // Build map of restaurant_id → { table_name, most_recent_activity_at }
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

                // Now fetch matching restaurant rows for those IDs
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

            // Tier 2: other persisted restaurants matching the query (not in tier 1)
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

            // Verify membership
            const { data: membership, error: memberErr } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', tableId)
                .eq('member_id', user.id)
                .maybeSingle();
            if (memberErr) throw memberErr;
            if (!membership) return fail('Not a member of this table', 403);

            // Fetch restaurant record (for header display on restaurant screen)
            const { data: restaurant, error: restErr } = await supabase
                .from('restaurants')
                .select('id, name, address, city, country, photo_url')
                .eq('id', restaurantId)
                .maybeSingle();
            if (restErr) throw restErr;

            // All REVEALED rounds at this restaurant in this table
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

            // All solo entries at this restaurant in this table (no table_night_id)
            const { data: soloEntries, error: entriesErr } = await supabase
                .from('entries')
                .select(`
                    id,
                    rating,
                    visited_at,
                    created_at,
                    user_id,
                    profiles ( display_name )
                `)
                .eq('table_id', tableId)
                .eq('restaurant_id', restaurantId)
                .is('table_night_id', null)
                .not('rating', 'is', null)
                .order('visited_at', { ascending: false });
            if (entriesErr) throw entriesErr;

            // Normalize into Visit[]
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

            // Sort by date desc, tiebreak by created_at desc if available (date already covers it well enough)
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

        return fail('Unknown action', 400);
    } catch (err) {
        console.error('restaurant-history error:', err);
        return json(
            { error: 'Internal Server Error', details: String(err) },
            500,
        );
    }
});
