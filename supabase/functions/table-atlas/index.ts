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
import { reportError } from '../_shared/report.ts';
import { projectRound } from '../_shared/round_projection.ts';
import { buildPage, decodeCursor } from '../_shared/pagination.ts';

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

type RoundParticipant = {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
};

type VisitRow =
    | {
          kind: 'round';
          id: string;
          /** Lead user_id (first participant) — kept for backward compat */
          user_id: string;
          display_name: string;
          avatar_url: string | null;
          rating: number | null;
          date: string;
          table_night_id: string;
          /** All participants for the peek sheet */
          round_participants: RoundParticipant[];
      }
    | {
          kind: 'solo';
          id: string;
          user_id: string;
          display_name: string;
          avatar_url: string | null;
          rating: number | null;
          date: string;
          entry_id: string;
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
    rows: RestaurantTile[];
    next_cursor: string | null;
    has_more: boolean;
};

// TICKET-139: the table's been-together map pins — group meals (suppers + legacy
// rounds) with coordinates, one row per restaurant (most-recent group meal wins).
type MapPinParticipant = { user_id: string; display_name: string; avatar_url: string | null };
type MapPinRow = {
    restaurant_id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
    lat: number; // coords-only rows (filtered NOT NULL)
    lng: number;
    supper_id: string | null; // winner's supper id; null when the winner is a legacy round
    gathered_on: string; // ISO — suppers.created_at | round.revealed_at ?? created_at
    participants: MapPinParticipant[]; // ≤5, batch-hydrated by id (never an embed off entries)
    suppers_count: number; // total group meals at this restaurant (for "×N")
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

    // ── Solo entries for this table (exclude Round-generated entry rows) ────────
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
                lat,
                lng
            )
        `)
        .eq('table_id', tableId)
        .is('table_night_id', null)
        .not('restaurants.city', 'is', null);
    if (entryErr) throw entryErr;

    // ── Rounds for this table (live revealed + merged) ────────────────────────
    // TICKET-044: include merged rounds (kind='merged', status=NULL).
    // The .or() filter covers both: revealed live rounds AND merged rounds.
    const { data: nights, error: nightErr } = await supabase
        .from('table_nights')
        .select(`
            id,
            kind,
            restaurant_id,
            revealed_at,
            created_at,
            restaurants (
                id,
                name,
                city,
                photo_url,
                lat,
                lng
            )
        `)
        .eq('table_id', tableId)
        .or('kind.eq.merged,status.eq.revealed')
        .not('restaurants.city', 'is', null);
    if (nightErr) throw nightErr;

    // ── Aggregate by city ─────────────────────────────────────────────────────
    // Map: city → { restaurant_ids: Set, user_ids: Set, last_visit_at, photo }
    type CityEntry = {
        restaurant_ids: Set<string>;
        user_ids: Set<string>;
        last_visit_at: string;
        // hero photo tracks the most-recent dated photo across all restaurants in the city
        hero_photo_url: string | null;
        hero_photo_date: string;
    };

    const cityMap = new Map<string, CityEntry>();

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
                hero_photo_date: photo ? date : '',
            });
        } else {
            existing.restaurant_ids.add(restaurantId);
            if (userId) existing.user_ids.add(userId);
            if (date > existing.last_visit_at) existing.last_visit_at = date;
            // Pick photo from the most-recent visit that has one
            if (photo && date >= existing.hero_photo_date) {
                existing.hero_photo_url = photo;
                existing.hero_photo_date = date;
            }
        }
    }

    for (const e of (entries ?? []) as any[]) {
        const r = e.restaurants;
        if (!r || !r.city) continue;
        upsertCity(r.city, r.id, e.user_id, e.visited_at ?? e.created_at, r.photo_url);
    }
    // TICKET-044: use projectRound for participant resolution (live and merged).
    for (const n of (nights ?? []) as any[]) {
        const r = n.restaurants;
        if (!r || !r.city) continue;
        const date = n.revealed_at ?? n.created_at;
        const roundKind: 'live' | 'merged' = n.kind === 'merged' ? 'merged' : 'live';
        const { participants } = await projectRound(n.id, roundKind, supabase);
        for (const p of participants) {
            upsertCity(r.city, r.id, p.user_id, date, r.photo_url);
        }
        if (participants.length === 0) {
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
        spots: sortedCities.reduce((sum, c) => sum + c.spot_count, 0),
        founded_at: tableRow?.created_at ?? null,
    };

    const response: CityIndexResponse = { stats, cities: sortedCities };
    return json({ data: response });
}

// ── Action: city-page ─────────────────────────────────────────────────────────

const CITY_PAGE_SIZE = 50;
const CITY_PAGE_MAX = 100;

async function handleCityPage(
    supabase: any,
    userId: string,
    tableId: string,
    city: string,
    cursor: string | null,
    pageSize: number,
): Promise<Response> {
    // Step 1: Get the paginated restaurant IDs via RPC (keyset-sorted by last_visit_date DESC)
    const decoded = decodeCursor(cursor);
    const { data: rpcRows, error: rpcErr } = await supabase.rpc('fn_atlas_city_restaurants', {
        p_table_id: tableId,
        p_city: city,
        p_cursor_date: decoded?.sort_date ?? null,
        p_cursor_id: decoded?.id ?? null,
        p_limit: pageSize + 1,
    });
    if (rpcErr) throw rpcErr;

    // Detect has_more from the +1 sentinel row
    const rpcList = (rpcRows ?? []) as { restaurant_id: string; last_visit_date: string }[];
    const has_more = rpcList.length > pageSize;
    const pageRestaurantIds = has_more ? rpcList.slice(0, pageSize) : rpcList;

    if (pageRestaurantIds.length === 0) {
        // No restaurants in city (or past the last page)
        const cityStats: CityStats = { city, spot_count: 0, member_count: 0 };
        const response: CityPageResponse = {
            city,
            city_stats: cityStats,
            rows: [],
            next_cursor: null,
            has_more: false,
        };
        return json({ data: response });
    }

    const restaurantIds = pageRestaurantIds.map((r) => r.restaurant_id);

    // Step 2: Fetch solo entries for these restaurants in this table
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
                cuisine,
                city,
                photo_url,
                lat,
                lng
            )
        `)
        .eq('table_id', tableId)
        .is('table_night_id', null)
        .in('restaurant_id', restaurantIds);
    if (entryErr) throw entryErr;

    // Companion join-table lookup — keyed by entry_id
    const entryIds = ((entries ?? []) as any[]).map((e) => e.id as string);
    const companionsByEntry = new Map<string, string[]>();
    if (entryIds.length > 0) {
        const { data: companionRows, error: companionErr } = await supabase
            .from('entry_companions')
            .select('entry_id, user_id')
            .in('entry_id', entryIds);
        if (companionErr) throw companionErr;
        for (const c of (companionRows ?? []) as any[]) {
            const list = companionsByEntry.get(c.entry_id) ?? [];
            list.push(c.user_id);
            companionsByEntry.set(c.entry_id, list);
        }
    }

    // Step 3: Fetch rounds for these restaurants in this table.
    // TICKET-044: include merged rounds (kind='merged') alongside live revealed rounds.
    const { data: nights, error: nightErr } = await supabase
        .from('table_nights')
        .select(`
            id,
            kind,
            restaurant_id,
            revealed_at,
            created_at,
            restaurants (
                id,
                name,
                cuisine,
                city,
                photo_url,
                lat,
                lng
            )
        `)
        .eq('table_id', tableId)
        .in('restaurant_id', restaurantIds)
        .or('kind.eq.merged,status.eq.revealed');
    if (nightErr) throw nightErr;

    // Step 4: Viewer's wishlist restaurant IDs
    const { data: wishlistRows, error: wishErr } = await supabase
        .from('wishlist_items')
        .select('restaurant_id')
        .eq('user_id', userId);
    if (wishErr) throw wishErr;
    const wishedIds = new Set(
        (wishlistRows ?? []).map((w: any) => w.restaurant_id as string),
    );

    // Step 5: Collect user IDs for profile fetch.
    // TICKET-044: projectRound handles participant resolution; we just need entry user_ids here.
    // Round participant user IDs are collected after projectRound calls below.
    const allUserIds = new Set<string>();
    for (const e of (entries ?? []) as any[]) allUserIds.add(e.user_id);
    // Round participants fetched lazily via projectRound; collect after projection.
    const profiles = await fetchProfiles(supabase, [...allUserIds]);

    // Step 6: Build per-restaurant aggregates (only for restaurantIds on this page)
    type RestaurantAgg = {
        id: string;
        name: string;
        cuisine: string | null;
        photo_url: string | null;
        lat: number | null;
        lng: number | null;
        last_visit_date: string;
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

    // Pre-populate from RPC results so we preserve the keyset order
    for (const rr of pageRestaurantIds) {
        restaurantMap.set(rr.restaurant_id, {
            id: rr.restaurant_id,
            name: '',
            cuisine: null,
            photo_url: null,
            lat: null,
            lng: null,
            last_visit_date: rr.last_visit_date,
            round_visits: [],
            solo_visits: [],
            companion_ids_union: new Set(),
        });
    }

    function ensureRestaurant(r: any): RestaurantAgg {
        const existing = restaurantMap.get(r.id);
        if (existing) {
            // Hydrate metadata if not yet set
            if (!existing.name) {
                existing.name = r.name;
                existing.cuisine = r.cuisine ?? null;
                existing.photo_url = r.photo_url ?? null;
                existing.lat = r.lat ?? null;
                existing.lng = r.lng ?? null;
            }
            return existing;
        }
        // Restaurant not in this page — skip
        const stub: RestaurantAgg = {
            id: r.id,
            name: r.name,
            cuisine: r.cuisine ?? null,
            photo_url: r.photo_url ?? null,
            lat: r.lat ?? null,
            lng: r.lng ?? null,
            last_visit_date: '',
            round_visits: [],
            solo_visits: [],
            companion_ids_union: new Set(),
        };
        // Don't add to map — we only process restaurants in this page
        return stub;
    }

    for (const e of (entries ?? []) as any[]) {
        const r = e.restaurants;
        if (!r || !restaurantMap.has(r.id)) continue;
        const agg = ensureRestaurant(r);
        agg.solo_visits.push({
            entry_id: e.id,
            user_id: e.user_id,
            rating: e.rating ?? null,
            date: e.visited_at ?? e.created_at,
        });
        for (const cId of (companionsByEntry.get(e.id) ?? [])) {
            agg.companion_ids_union.add(cId);
        }
    }

    // TICKET-044: use projectRound for live and merged rounds.
    for (const n of (nights ?? []) as any[]) {
        const r = n.restaurants;
        if (!r || !restaurantMap.has(r.id)) continue;
        const agg = ensureRestaurant(r);
        const roundKind: 'live' | 'merged' = n.kind === 'merged' ? 'merged' : 'live';
        const { participants, average_rating } = await projectRound(n.id, roundKind, supabase);
        const participantUserIds = participants.map((p) => p.user_id);
        // Collect new user IDs for profile map
        for (const p of participants) {
            if (!profiles.has(p.user_id)) {
                profiles.set(p.user_id, {
                    display_name: p.display_name,
                    avatar_url: p.avatar_url,
                    username: null,
                });
            }
        }
        agg.round_visits.push({
            night_id: n.id,
            average_rating,
            date: n.revealed_at ?? n.created_at,
            participant_user_ids: participantUserIds,
        });
    }

    // Step 7: Build tiles in RPC sort order (last_visit_date DESC, restaurant_id DESC)
    const cityMemberIds = new Set<string>();
    const tiles: RestaurantTile[] = [];

    for (const rr of pageRestaurantIds) {
        const agg = restaurantMap.get(rr.restaurant_id);
        if (!agg || !agg.name) continue; // unfilled means no visits in DB (shouldn't happen)

        const hasRound = agg.round_visits.length > 0;
        const hasSolo = agg.solo_visits.length > 0;
        const tile_type: 'solo' | 'round' | 'mixed' = hasRound
            ? hasSolo ? 'mixed' : 'round'
            : 'solo';

        // Rating derivation
        let rating: number | null = null;
        if (hasRound) {
            const latestRound = agg.round_visits.sort((a, b) =>
                b.date.localeCompare(a.date),
            )[0];
            rating = latestRound.average_rating;
        } else {
            const viewerSolos = agg.solo_visits.filter((v) => v.user_id === userId);
            if (viewerSolos.length > 0) {
                const ratedSolos = viewerSolos.filter((v) => v.rating != null);
                if (ratedSolos.length > 0) {
                    rating = ratedSolos.reduce((sum, v) => sum + v.rating!, 0) / ratedSolos.length;
                }
            }
            if (rating == null) {
                const sorted = agg.solo_visits
                    .filter((v) => v.rating != null)
                    .sort((a, b) => b.date.localeCompare(a.date));
                if (sorted.length > 0) rating = sorted[0].rating;
            }
        }

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

        const visits: VisitRow[] = [
            ...agg.round_visits
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((rv) => {
                    const roundParticipants: RoundParticipant[] =
                        rv.participant_user_ids.map((uid) => ({
                            user_id: uid,
                            display_name: profiles.get(uid)?.display_name ?? 'Tablemate',
                            avatar_url: profiles.get(uid)?.avatar_url ?? null,
                        }));
                    const leadUid = rv.participant_user_ids[0] ?? '';
                    return {
                        kind: 'round' as const,
                        id: rv.night_id,
                        user_id: leadUid,
                        display_name: profiles.get(leadUid)?.display_name ?? 'Tablemate',
                        avatar_url: profiles.get(leadUid)?.avatar_url ?? null,
                        rating: rv.average_rating,
                        date: rv.date,
                        table_night_id: rv.night_id,
                        round_participants: roundParticipants,
                    };
                }),
            ...agg.solo_visits
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((sv) => ({
                    kind: 'solo' as const,
                    id: sv.entry_id,
                    user_id: sv.user_id,
                    display_name: profiles.get(sv.user_id)?.display_name ?? 'Member',
                    avatar_url: profiles.get(sv.user_id)?.avatar_url ?? null,
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
            member_names: memberIds.map((id) => profiles.get(id)?.display_name ?? 'Member'),
            member_avatar_urls: memberIds.map((id) => profiles.get(id)?.avatar_url ?? null),
        });
    }

    // Build the next_cursor via buildPage applied to the RPC list
    const rpcPage = buildPage(
        pageRestaurantIds,
        pageSize,
        (r) => ({ sort_date: r.last_visit_date, id: r.restaurant_id }),
    );
    const next_cursor = rpcPage.next_cursor;

    const cityStats: CityStats = {
        city,
        spot_count: tiles.length,
        member_count: cityMemberIds.size,
    };

    const response: CityPageResponse = {
        city,
        city_stats: cityStats,
        rows: tiles,
        next_cursor,
        has_more,
    };
    return json({ data: response });
}

// ── Action: map_pins (TICKET-139) ───────────────────────────────────────────────
// The table's been-together layer: suppers (primary) ∪ legacy rounds
// (table_nights merged|revealed — the atlas's existing group definition),
// collapsed to one row per restaurant (most-recent group meal wins; suppers_count
// counts all). Member-gated by the main handler's checkMembership 403 BEFORE this
// runs. Every query is scoped to `tableId`; participants are batch-hydrated by id
// via fetchProfiles — NEVER a PostgREST embed off entries (entries has no FK to
// profiles). Cap 200, ordered by recency.

async function handleMapPins(supabase: any, tableId: string): Promise<Response> {
    // ── suppers for this table, coords required ──
    const { data: suppers, error: sErr } = await supabase
        .from('suppers')
        .select(`
            id,
            restaurant_id,
            created_at,
            restaurants!inner (
                id, name, city, cuisine, lat, lng
            )
        `)
        .eq('table_id', tableId)
        .not('restaurants.lat', 'is', null)
        .not('restaurants.lng', 'is', null);
    if (sErr) throw sErr;

    // rosters: supper_members for the fetched suppers (service-role read)
    const supperIds = ((suppers ?? []) as any[]).map((s) => s.id as string);
    const membersBySupper = new Map<string, string[]>();
    if (supperIds.length > 0) {
        const { data: mrows, error: mErr } = await supabase
            .from('supper_members')
            .select('supper_id, user_id')
            .in('supper_id', supperIds);
        if (mErr) throw mErr;
        for (const m of (mrows ?? []) as any[]) {
            const list = membersBySupper.get(m.supper_id) ?? [];
            list.push(m.user_id);
            membersBySupper.set(m.supper_id, list);
        }
    }

    // ── legacy rounds for this table (atlas's existing group definition) ──
    const { data: nights, error: nErr } = await supabase
        .from('table_nights')
        .select(`
            id,
            kind,
            restaurant_id,
            revealed_at,
            created_at,
            restaurants!inner (
                id, name, city, cuisine, lat, lng
            )
        `)
        .eq('table_id', tableId)
        .or('kind.eq.merged,status.eq.revealed')
        .not('restaurants.lat', 'is', null)
        .not('restaurants.lng', 'is', null);
    if (nErr) throw nErr;

    // ── collapse to one row per restaurant; most-recent group meal wins; count all ──
    type Agg = {
        restaurant_id: string;
        name: string;
        city: string | null;
        cuisine: string | null;
        lat: number;
        lng: number;
        supper_id: string | null;
        gathered_on: string;
        count: number;
        participantIds: string[];
    };
    const byRestaurant = new Map<string, Agg>();
    function bump(r: any, date: string, supperId: string | null, pids: string[]) {
        const cur = byRestaurant.get(r.id);
        if (!cur) {
            byRestaurant.set(r.id, {
                restaurant_id: r.id,
                name: r.name,
                city: r.city ?? null,
                cuisine: r.cuisine ?? null,
                lat: r.lat,
                lng: r.lng,
                supper_id: supperId,
                gathered_on: date,
                count: 1,
                participantIds: pids.slice(0, 5),
            });
            return;
        }
        cur.count++;
        if (date > cur.gathered_on) {
            cur.gathered_on = date;
            cur.supper_id = supperId;
            cur.participantIds = pids.slice(0, 5);
        }
    }

    for (const s of (suppers ?? []) as any[]) {
        const r = s.restaurants;
        if (!r) continue;
        bump(r, s.created_at, s.id, membersBySupper.get(s.id) ?? []);
    }
    for (const n of (nights ?? []) as any[]) {
        const r = n.restaurants;
        if (!r) continue;
        const roundKind: 'live' | 'merged' = n.kind === 'merged' ? 'merged' : 'live';
        const { participants } = await projectRound(n.id, roundKind, supabase);
        bump(r, n.revealed_at ?? n.created_at, null, participants.map((p) => p.user_id));
    }

    // ── hydrate ≤5 participant profiles by id (batch, never an embed off entries) ──
    const allIds = [...byRestaurant.values()].flatMap((a) => a.participantIds);
    const profiles = await fetchProfiles(supabase, allIds);

    const rows: MapPinRow[] = [...byRestaurant.values()]
        .sort((a, b) => (a.gathered_on > b.gathered_on ? -1 : 1)) // recency
        .slice(0, 200) // cap 200
        .map((a) => ({
            restaurant_id: a.restaurant_id,
            name: a.name,
            city: a.city,
            cuisine: a.cuisine,
            lat: a.lat,
            lng: a.lng,
            supper_id: a.supper_id,
            gathered_on: a.gathered_on,
            suppers_count: a.count,
            participants: a.participantIds.map((id) => ({
                user_id: id,
                display_name: profiles.get(id)?.display_name ?? 'Member',
                avatar_url: profiles.get(id)?.avatar_url ?? null,
            })),
        }));

    return json({ data: { rows } });
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
        const { action, table_id, city, cursor, limit } = body as {
            action?: string;
            table_id?: string;
            city?: string;
            cursor?: string | null;
            limit?: number;
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
            const pageSize = Math.min(Math.max(limit ?? CITY_PAGE_SIZE, 1), CITY_PAGE_MAX);
            return await handleCityPage(supabase, user.id, table_id, city, cursor ?? null, pageSize);
        }

        if (action === 'map_pins') {
            return await handleMapPins(supabase, table_id);
        }

        return fail(`Unknown action: ${action}`, 400);
    } catch (err) {
        console.error('table-atlas error:', err);
        reportError(err, { fn: 'table-atlas' });
        return json({ error: String(err) }, 500);
    }
});
