/**
 * top-fours — Personal regional Top 4s edge function.
 * TICKET-047
 *
 * Actions (GET):
 *   get                         — owner or public-profile view
 *   available_cities            — owner-only; cities eligible to claim
 *   eligible_restaurants_for_city — owner-only; pick candidates for a city
 *
 * Actions (POST body { action, ... }):
 *   claim           — first-claim a city with picks (calls claim_city_with_picks RPC)
 *   update_picks    — update picks for an already-claimed city
 *   set_profile_takes — atomically replace/clear the profile's Quick takes
 *   unclaim         — remove a claimed city (calls unclaim_city RPC)
 *   set_home        — set a city as HOME (calls set_user_home_city RPC)
 *   dismiss_nudge   — snooze the claim nudge for a city for 30 days
 *
 * Pattern: service-role client, manual auth.getUser check, jsonResponse helper.
 * Follows wishlist/index.ts and restaurant-history/index.ts patterns.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { reportError } from '../_shared/report.ts';
import { replaceProfileTakes } from './profileTakes.ts';

// ── Types ──────────────────────────────────────────────────────────────────

interface PickInput {
    position: number;
    restaurant_id: string;
    // TICKET-144 pt2 — profile Top 4 only: per-slot chosen-memory hero photo.
    // Rides inside each pick; the RPC validates it is the user's OWN photo at
    // this restaurant. Regional Top-4 flows ignore this field.
    hero_entry_photo_id?: string | null;
}

interface ClaimedCity {
    city: string;
    is_home: boolean;
    claimed_at: string;
    distinct_restaurant_count: number;
    picks: Array<{
        position: 1 | 2 | 3 | 4;
        restaurant: {
            id: string;
            name: string;
            city: string | null;
            photo_url: string | null;
        };
    }>;
}

interface NudgePayload {
    city: string;
    distinct_restaurant_count: number;
    log_count: number;
}

interface TopFoursPayload {
    user_id: string;
    is_owner: boolean;
    home_city: string | null;
    claimed_cities: ClaimedCity[];
    nudge: NudgePayload | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function errResponse(code: string, message: string, status = 400) {
    return jsonResponse({ error: { code, message } }, status);
}

// Compute per-city stats (distinct restaurants logged + total log count) for a user.
// Joins entries × restaurants on canonical city. Excludes null/empty/Elsewhere cities.
// Single source of truth — used for both the populated-state "n places" sub-line
// and the nudge candidate eligibility check.
async function computeUserCityStats(
    supabase: ReturnType<typeof createClient<any>>,
    userId: string,
): Promise<Map<string, { distinct_n: number; log_n: number }>> {
    const { data: entriesData, error: entriesErr } = await supabase
        .from('entries')
        .select('restaurant_id')
        .eq('user_id', userId);
    if (entriesErr) throw new Error(entriesErr.message);
    if (!entriesData || entriesData.length === 0) return new Map();

    const restIds = [...new Set(entriesData.map((e: { restaurant_id: string }) => e.restaurant_id))];

    const { data: restaurants, error: restsErr } = await supabase
        .from('restaurants')
        .select('id, city')
        .in('id', restIds)
        .not('city', 'is', null)
        .neq('city', '')
        .neq('city', 'Elsewhere');
    if (restsErr) throw new Error(restsErr.message);
    if (!restaurants || restaurants.length === 0) return new Map();

    const restCityById = new Map<string, string>();
    for (const r of restaurants as Array<{ id: string; city: string | null }>) {
        if (r.city) restCityById.set(r.id, r.city);
    }

    const stats = new Map<string, { distinct_n: number; log_n: number; restaurants: Set<string> }>();
    for (const e of entriesData as Array<{ restaurant_id: string }>) {
        const city = restCityById.get(e.restaurant_id);
        if (!city) continue;
        let entry = stats.get(city);
        if (!entry) {
            entry = { distinct_n: 0, log_n: 0, restaurants: new Set() };
            stats.set(city, entry);
        }
        entry.log_n += 1;
        entry.restaurants.add(e.restaurant_id);
    }

    const result = new Map<string, { distinct_n: number; log_n: number }>();
    for (const [city, entry] of stats) {
        result.set(city, { distinct_n: entry.restaurants.size, log_n: entry.log_n });
    }
    return result;
}

// ── get helper — builds the full TopFoursPayload ───────────────────────────

async function buildGetPayload(
    supabase: ReturnType<typeof createClient<any>>,
    targetUserId: string,
    isOwner: boolean,
): Promise<TopFoursPayload> {
    // Fetch claimed cities ordered: is_home desc, claimed_at desc
    const { data: cities, error: citiesErr } = await supabase
        .from('user_claimed_cities')
        .select('city, is_home, claimed_at')
        .eq('user_id', targetUserId)
        .order('is_home', { ascending: false })
        .order('claimed_at', { ascending: false });

    if (citiesErr) throw new Error(citiesErr.message);

    // Fetch all picks for these cities
    const { data: allPicks, error: picksErr } = await supabase
        .from('user_top_4')
        .select('city, position, restaurant_id')
        .eq('user_id', targetUserId)
        .order('position', { ascending: true });

    if (picksErr) throw new Error(picksErr.message);

    // Fetch restaurant rows for all pick restaurant_ids
    const restaurantIds = [...new Set((allPicks ?? []).map((p: { restaurant_id: string }) => p.restaurant_id))];
    let restaurantMap: Map<string, { id: string; name: string; city: string | null; photo_url: string | null }> = new Map();

    if (restaurantIds.length > 0) {
        const { data: rests, error: restsErr } = await supabase
            .from('restaurants')
            .select('id, name, city, photo_url')
            .in('id', restaurantIds);
        if (restsErr) throw new Error(restsErr.message);
        for (const r of (rests ?? [])) {
            restaurantMap.set(r.id, r);
        }
    }

    // Compute distinct_restaurant_count per claimed city. Single source of truth
    // shared with the nudge eligibility check.
    const claimedCityNames = (cities ?? []).map((c: { city: string }) => c.city);
    const countMap = new Map<string, number>();
    let cityStats: Map<string, { distinct_n: number; log_n: number }> | null = null;
    if (claimedCityNames.length > 0 || isOwner) {
        cityStats = await computeUserCityStats(supabase, targetUserId);
        for (const name of claimedCityNames) {
            countMap.set(name, cityStats.get(name)?.distinct_n ?? 0);
        }
    }

    // Build claimed_cities array
    const claimedCities: ClaimedCity[] = (cities ?? []).map((c: { city: string; is_home: boolean; claimed_at: string }) => {
        const cityPicks = (allPicks ?? [])
            .filter((p: { city: string }) => p.city === c.city)
            .map((p: { city: string; position: number; restaurant_id: string }) => {
                const rest = restaurantMap.get(p.restaurant_id);
                return {
                    position: p.position as 1 | 2 | 3 | 4,
                    restaurant: rest ?? null,
                };
            })
            .filter((p: { restaurant: unknown }) => p.restaurant !== null) as ClaimedCity['picks'];

        return {
            city: c.city,
            is_home: c.is_home,
            claimed_at: c.claimed_at,
            distinct_restaurant_count: countMap.get(c.city) ?? 0,
            picks: cityPicks,
        };
    });

    const homeCity = (cities ?? []).find((c: { is_home: boolean }) => c.is_home)?.city ?? null;

    // Nudge: only for owner. Reuses cityStats already computed above.
    let nudge: NudgePayload | null = null;
    if (isOwner) {
        nudge = await computeNudge(supabase, targetUserId, cityStats);
    }

    return {
        user_id: targetUserId,
        is_owner: isOwner,
        home_city: homeCity,
        claimed_cities: claimedCities,
        nudge,
    };
}

// Compute the claim nudge for the owner:
// ≥10 logs across ≥3 distinct restaurants in an unclaimed canonical city,
// not dismissed within 30 days, not 'Elsewhere', city is not null/empty.
async function computeNudge(
    supabase: ReturnType<typeof createClient<any>>,
    userId: string,
    precomputedStats: Map<string, { distinct_n: number; log_n: number }> | null,
): Promise<NudgePayload | null> {
    const stats = precomputedStats ?? (await computeUserCityStats(supabase, userId));
    if (stats.size === 0) return null;

    const { data: claimedData, error: claimedErr } = await supabase
        .from('user_claimed_cities')
        .select('city')
        .eq('user_id', userId);
    if (claimedErr) throw new Error(claimedErr.message);
    const claimedSet = new Set((claimedData ?? []).map((c: { city: string }) => c.city));

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: dismissedData, error: dismissedErr } = await supabase
        .from('user_claim_nudge_dismissals')
        .select('city')
        .eq('user_id', userId)
        .gt('dismissed_at', thirtyDaysAgo);
    if (dismissedErr) throw new Error(dismissedErr.message);
    const dismissedSet = new Set((dismissedData ?? []).map((d: { city: string }) => d.city));

    let best: { city: string; distinct_n: number; log_n: number } | null = null;
    for (const [city, counts] of stats) {
        if (claimedSet.has(city) || dismissedSet.has(city)) continue;
        if (counts.log_n < 10 || counts.distinct_n < 3) continue;
        if (
            !best ||
            counts.distinct_n > best.distinct_n ||
            (counts.distinct_n === best.distinct_n && counts.log_n > best.log_n)
        ) {
            best = { city, distinct_n: counts.distinct_n, log_n: counts.log_n };
        }
    }

    if (!best) return null;
    return {
        city: best.city,
        distinct_restaurant_count: best.distinct_n,
        log_count: best.log_n,
    };
}

// ── Handler ────────────────────────────────────────────────────────────────

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // ── Auth ──────────────────────────────────────────────────────
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return errResponse('UNAUTHORIZED', 'Missing Authorization header', 401);
        }

        const token = authHeader.replace('Bearer ', '');
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        // Service-role client: bypasses RLS, auth validated manually below
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return errResponse('UNAUTHORIZED', 'Invalid or expired token', 401);
        }

        const url = new URL(req.url);
        const action = url.searchParams.get('action');

        // ── GET actions ───────────────────────────────────────────────

        if (req.method === 'GET') {
            // ── get ───────────────────────────────────────────────────
            if (action === 'get') {
                const targetUserId = url.searchParams.get('user_id');
                if (!targetUserId) {
                    return errResponse('BAD_REQUEST', 'user_id is required');
                }

                const isOwner = user.id === targetUserId;

                if (!isOwner) {
                    // Check target profile is public
                    const { data: profile, error: profileErr } = await supabase
                        .from('profiles')
                        .select('account_privacy')
                        .eq('user_id', targetUserId)
                        .maybeSingle();

                    if (profileErr) {
                        return errResponse('DB_ERROR', profileErr.message, 500);
                    }
                    if (!profile || profile.account_privacy !== 'public') {
                        return errResponse('NOT_FOUND', 'Profile not found or not public', 404);
                    }
                }

                const payload = await buildGetPayload(supabase, targetUserId, isOwner);
                return jsonResponse({ data: payload });
            }

            // ── available_cities (owner-only) ─────────────────────────
            if (action === 'available_cities') {
                const targetUserId = url.searchParams.get('user_id');
                if (!targetUserId) return errResponse('BAD_REQUEST', 'user_id is required');
                if (user.id !== targetUserId) {
                    return errResponse('FORBIDDEN', 'available_cities is owner-only', 403);
                }

                // Distinct cities from entries × restaurants, excluding already-claimed,
                // 'Elsewhere', and null/empty. [ARCH-10] Return all — no cap.
                const { data: entriesData } = await supabase
                    .from('entries')
                    .select('restaurant_id')
                    .eq('user_id', user.id);

                if (!entriesData || entriesData.length === 0) {
                    return jsonResponse({ data: [] });
                }

                const restIds = [...new Set(entriesData.map((e: { restaurant_id: string }) => e.restaurant_id))];

                const { data: restaurants } = await supabase
                    .from('restaurants')
                    .select('id, city')
                    .in('id', restIds)
                    .not('city', 'is', null)
                    .neq('city', '')
                    .neq('city', 'Elsewhere');

                if (!restaurants) return jsonResponse({ data: [] });

                const { data: claimedData } = await supabase
                    .from('user_claimed_cities')
                    .select('city')
                    .eq('user_id', user.id);
                const claimedSet = new Set((claimedData ?? []).map((c: { city: string }) => c.city));

                // Build city → distinct restaurant_id set
                const cityMap: Map<string, Set<string>> = new Map();
                for (const r of restaurants) {
                    if (!r.city || claimedSet.has(r.city)) continue;
                    if (!cityMap.has(r.city)) cityMap.set(r.city, new Set());
                    cityMap.get(r.city)!.add(r.id);
                }

                const result = Array.from(cityMap.entries())
                    .map(([city, rids]) => ({ city, distinct_restaurant_count: rids.size }))
                    .sort((a, b) => b.distinct_restaurant_count - a.distinct_restaurant_count);

                return jsonResponse({ data: result });
            }

            // ── eligible_restaurants_for_city (owner-only) ────────────
            if (action === 'eligible_restaurants_for_city') {
                const targetUserId = url.searchParams.get('user_id');
                const city = url.searchParams.get('city');
                if (!targetUserId) return errResponse('BAD_REQUEST', 'user_id is required');
                if (!city) return errResponse('BAD_REQUEST', 'city is required');
                if (user.id !== targetUserId) {
                    return errResponse('FORBIDDEN', 'eligible_restaurants_for_city is owner-only', 403);
                }

                // Get all restaurants in this city that the user has logged.
                // [ARCH-10] Return all — no cap.
                const { data: cityRestaurants, error: cityRestErr } = await supabase
                    .from('restaurants')
                    .select('id, name, photo_url, city')
                    .eq('city', city);

                if (cityRestErr) {
                    return errResponse('DB_ERROR', cityRestErr.message, 500);
                }
                if (!cityRestaurants || cityRestaurants.length === 0) {
                    return jsonResponse({ data: [] });
                }

                const cityRestIds = cityRestaurants.map((r: { id: string }) => r.id);

                // Get entries for this user in these restaurants. Canonical column is `entries.rating`.
                const { data: entriesData, error: entriesErr } = await supabase
                    .from('entries')
                    .select('restaurant_id, rating, created_at')
                    .eq('user_id', user.id)
                    .in('restaurant_id', cityRestIds);

                if (entriesErr) {
                    return errResponse('DB_ERROR', entriesErr.message, 500);
                }
                if (!entriesData || entriesData.length === 0) {
                    return jsonResponse({ data: [] });
                }

                // Aggregate by restaurant: max rating, most recent log
                const aggMap: Map<string, { last_logged_at: string; best_rating: number | null }> = new Map();
                for (const e of entriesData as Array<{ restaurant_id: string; rating: number | null; created_at: string }>) {
                    const existing = aggMap.get(e.restaurant_id);
                    if (!existing) {
                        aggMap.set(e.restaurant_id, {
                            last_logged_at: e.created_at,
                            best_rating: e.rating,
                        });
                    } else {
                        if (e.created_at > existing.last_logged_at) {
                            existing.last_logged_at = e.created_at;
                        }
                        if (e.rating != null) {
                            if (existing.best_rating == null || e.rating > existing.best_rating) {
                                existing.best_rating = e.rating;
                            }
                        }
                    }
                }

                const restMap = new Map(cityRestaurants.map((r: { id: string; name: string; photo_url: string | null; city: string | null }) => [r.id, r]));

                const result = Array.from(aggMap.entries())
                    .map(([restaurant_id, agg]) => {
                        const r = restMap.get(restaurant_id);
                        if (!r) return null;
                        return {
                            restaurant_id,
                            name: r.name,
                            photo_url: r.photo_url,
                            city: r.city,
                            last_logged_at: agg.last_logged_at,
                            best_rating: agg.best_rating,
                        };
                    })
                    .filter(Boolean)
                    .sort((a, b) => b!.last_logged_at.localeCompare(a!.last_logged_at));

                return jsonResponse({ data: result });
            }

            // ── eligible_restaurants (global — for the profile Top 4 picker) ──
            if (action === 'eligible_restaurants') {
                const targetUserId = url.searchParams.get('user_id');
                if (!targetUserId) return errResponse('BAD_REQUEST', 'user_id is required');
                if (user.id !== targetUserId) {
                    return errResponse('FORBIDDEN', 'eligible_restaurants is owner-only', 403);
                }

                // All restaurants the owner has logged, aggregated by best rating +
                // most-recent log. Global (no city filter). No cap (mirrors ARCH-10).
                const { data: entriesData, error: entriesErr } = await supabase
                    .from('entries')
                    .select('restaurant_id, rating, created_at')
                    .eq('user_id', user.id)
                    .not('restaurant_id', 'is', null);

                if (entriesErr) return errResponse('DB_ERROR', entriesErr.message, 500);
                if (!entriesData || entriesData.length === 0) return jsonResponse({ data: [] });

                const aggMap: Map<string, { last_logged_at: string; best_rating: number | null }> = new Map();
                for (const e of entriesData as Array<{ restaurant_id: string; rating: number | null; created_at: string }>) {
                    const existing = aggMap.get(e.restaurant_id);
                    if (!existing) {
                        aggMap.set(e.restaurant_id, { last_logged_at: e.created_at, best_rating: e.rating });
                    } else {
                        if (e.created_at > existing.last_logged_at) existing.last_logged_at = e.created_at;
                        if (e.rating != null && (existing.best_rating == null || e.rating > existing.best_rating)) {
                            existing.best_rating = e.rating;
                        }
                    }
                }

                const rids = Array.from(aggMap.keys());
                const { data: rests, error: restErr } = await supabase
                    .from('restaurants')
                    .select('id, name, photo_url, city')
                    .in('id', rids);
                if (restErr) return errResponse('DB_ERROR', restErr.message, 500);

                const restMap = new Map(
                    (rests ?? []).map((r: { id: string; name: string; photo_url: string | null; city: string | null }) => [r.id, r]),
                );
                const result = Array.from(aggMap.entries())
                    .map(([restaurant_id, agg]) => {
                        const r = restMap.get(restaurant_id);
                        if (!r) return null;
                        return {
                            restaurant_id,
                            name: r.name,
                            photo_url: r.photo_url,
                            city: r.city,
                            last_logged_at: agg.last_logged_at,
                            best_rating: agg.best_rating,
                        };
                    })
                    .filter(Boolean)
                    .sort((a, b) => b!.last_logged_at.localeCompare(a!.last_logged_at));

                return jsonResponse({ data: result });
            }

            return errResponse('BAD_REQUEST', `Unknown GET action: ${action}`);
        }

        // ── POST actions ──────────────────────────────────────────────

        if (req.method === 'POST') {
            const body = await req.json().catch(() => ({}));
            const postAction = body.action ?? action;

            // ── claim ──────────────────────────────────────────────────
            if (postAction === 'claim') {
                const { city, picks } = body as { city: string; picks: PickInput[] };

                if (!city || city === 'Elsewhere') {
                    return errResponse('BAD_REQUEST', 'city must be a valid canonical city, not Elsewhere');
                }
                if (!Array.isArray(picks) || picks.length === 0) {
                    return errResponse('BAD_REQUEST', 'picks must be a non-empty array');
                }

                // Check for duplicate restaurant_ids (ARCH-1 defense in depth at API layer)
                const rids = picks.map(p => p.restaurant_id);
                if (new Set(rids).size !== rids.length) {
                    return errResponse('DUPLICATE_PICK', 'picks contain duplicate restaurant_id values');
                }

                // Validate positions
                for (const p of picks) {
                    if (!Number.isInteger(p.position) || p.position < 1 || p.position > 4) {
                        return errResponse('BAD_REQUEST', `invalid position ${p.position} — must be 1–4`);
                    }
                }
                const positions = picks.map(p => p.position);
                if (new Set(positions).size !== positions.length) {
                    return errResponse('BAD_REQUEST', 'duplicate positions in picks');
                }

                try {
                    const { error: rpcErr } = await supabase.rpc('claim_city_with_picks', {
                        p_user_id: user.id,
                        p_city: city,
                        p_picks: picks,
                    });

                    if (rpcErr) {
                        return errResponse('RPC_ERROR', rpcErr.message);
                    }
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    return errResponse('RPC_ERROR', msg);
                }

                const payload = await buildGetPayload(supabase, user.id, true);
                return jsonResponse({ data: payload });
            }

            // ── update_picks ───────────────────────────────────────────
            if (postAction === 'update_picks') {
                const { city, picks } = body as { city: string; picks: PickInput[] };

                if (!city) return errResponse('BAD_REQUEST', 'city is required');
                if (!Array.isArray(picks) || picks.length === 0) {
                    return errResponse('BAD_REQUEST', 'picks must be a non-empty array');
                }

                // Check city is claimed
                const { data: claimedRow, error: claimedErr } = await supabase
                    .from('user_claimed_cities')
                    .select('city')
                    .eq('user_id', user.id)
                    .eq('city', city)
                    .maybeSingle();

                if (claimedErr) {
                    return errResponse('DB_ERROR', claimedErr.message, 500);
                }
                if (!claimedRow) {
                    return errResponse('BAD_REQUEST', 'city not yet claimed — use claim action');
                }

                // Duplicate restaurant_id check (ARCH-1 defense in depth)
                const rids = picks.map(p => p.restaurant_id);
                if (new Set(rids).size !== rids.length) {
                    return errResponse('DUPLICATE_PICK', 'picks contain duplicate restaurant_id values');
                }

                for (const p of picks) {
                    if (!Number.isInteger(p.position) || p.position < 1 || p.position > 4) {
                        return errResponse('BAD_REQUEST', `invalid position ${p.position} — must be 1–4`);
                    }
                }
                const positions = picks.map(p => p.position);
                if (new Set(positions).size !== positions.length) {
                    return errResponse('BAD_REQUEST', 'duplicate positions in picks');
                }

                try {
                    const { error: rpcErr } = await supabase.rpc('set_user_top_four_picks', {
                        p_user_id: user.id,
                        p_city: city,
                        p_picks: picks,
                    });
                    if (rpcErr) {
                        return errResponse('RPC_ERROR', rpcErr.message);
                    }
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    return errResponse('RPC_ERROR', msg);
                }

                const payload = await buildGetPayload(supabase, user.id, true);
                return jsonResponse({ data: payload });
            }

            // ── set_profile_picks (global profile Top 4 override) ──────
            if (postAction === 'set_profile_picks') {
                const { picks } = body as { picks: PickInput[] };
                if (!Array.isArray(picks)) {
                    return errResponse('BAD_REQUEST', 'picks must be an array');
                }
                if (picks.length > 4) {
                    return errResponse('BAD_REQUEST', 'picks must have at most 4 elements');
                }

                // Empty array is allowed — clears the override (reverts to auto-derive).
                const rids = picks.map(p => p.restaurant_id);
                if (new Set(rids).size !== rids.length) {
                    return errResponse('DUPLICATE_PICK', 'picks contain duplicate restaurant_id values');
                }
                for (const p of picks) {
                    if (!Number.isInteger(p.position) || p.position < 1 || p.position > 4) {
                        return errResponse('BAD_REQUEST', `invalid position ${p.position} — must be 1–4`);
                    }
                }
                const positions = picks.map(p => p.position);
                if (new Set(positions).size !== positions.length) {
                    return errResponse('BAD_REQUEST', 'duplicate positions in picks');
                }

                try {
                    // The RPC validates each hero_entry_photo_id belongs to the
                    // user AT that restaurant (consent boundary). picks pass
                    // through with hero_entry_photo_id inside each element.
                    const { error: rpcErr } = await supabase.rpc('set_profile_top_four_picks', {
                        p_user_id: user.id,
                        p_picks: picks,
                    });
                    if (rpcErr) {
                        if (rpcErr.message?.includes('PHOTO_NOT_OWNED')) {
                            return errResponse('PHOTO_NOT_OWNED', 'That photo is not yours at this restaurant');
                        }
                        return errResponse('RPC_ERROR', rpcErr.message);
                    }
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    if (msg.includes('PHOTO_NOT_OWNED')) {
                        return errResponse('PHOTO_NOT_OWNED', 'That photo is not yours at this restaurant');
                    }
                    return errResponse('RPC_ERROR', msg);
                }

                return jsonResponse({ data: { ok: true } });
            }

            // ── set_profile_takes (profile Quick takes) ────────────────
            // Full-set replacement, including clear via []. The SQL RPC repeats
            // validation and serializes writes with a per-user transaction lock;
            // this edge validation only supplies stable, friendly error envelopes.
            if (postAction === 'set_profile_takes') {
                const result = await replaceProfileTakes(
                    (name, args) => supabase.rpc(name, args),
                    user.id,
                    body.takes,
                );
                if (result.ok === false) return errResponse(result.code, result.message);
                return jsonResponse({ data: { ok: true } });
            }

            // ── unclaim ────────────────────────────────────────────────
            if (postAction === 'unclaim') {
                const { city } = body as { city: string };
                if (!city) return errResponse('BAD_REQUEST', 'city is required');

                try {
                    const { error: rpcErr } = await supabase.rpc('unclaim_city', {
                        p_user_id: user.id,
                        p_city: city,
                    });
                    if (rpcErr) {
                        return errResponse('RPC_ERROR', rpcErr.message);
                    }
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    return errResponse('RPC_ERROR', msg);
                }

                const payload = await buildGetPayload(supabase, user.id, true);
                return jsonResponse({ data: payload });
            }

            // ── set_home ───────────────────────────────────────────────
            if (postAction === 'set_home') {
                const { city } = body as { city: string };
                if (!city) return errResponse('BAD_REQUEST', 'city is required');

                // Check city is claimed before calling RPC (early 400)
                const { data: claimedRow, error: claimedErr } = await supabase
                    .from('user_claimed_cities')
                    .select('city')
                    .eq('user_id', user.id)
                    .eq('city', city)
                    .maybeSingle();

                if (claimedErr) {
                    return errResponse('DB_ERROR', claimedErr.message, 500);
                }
                if (!claimedRow) {
                    return errResponse('BAD_REQUEST', 'city not claimed by user');
                }

                try {
                    const { error: rpcErr } = await supabase.rpc('set_user_home_city', {
                        p_user_id: user.id,
                        p_city: city,
                    });
                    if (rpcErr) {
                        return errResponse('RPC_ERROR', rpcErr.message);
                    }
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    return errResponse('RPC_ERROR', msg);
                }

                const payload = await buildGetPayload(supabase, user.id, true);
                return jsonResponse({ data: payload });
            }

            // ── dismiss_nudge ──────────────────────────────────────────
            if (postAction === 'dismiss_nudge') {
                const { city } = body as { city: string };
                if (!city) return errResponse('BAD_REQUEST', 'city is required');

                const { error: upsertErr } = await supabase
                    .from('user_claim_nudge_dismissals')
                    .upsert(
                        { user_id: user.id, city, dismissed_at: new Date().toISOString() },
                        { onConflict: 'user_id,city' },
                    );

                if (upsertErr) {
                    return errResponse('DB_ERROR', upsertErr.message);
                }

                return jsonResponse({ data: { success: true } });
            }

            // ── my_restaurant_photos (TICKET-144 pt2 — chosen-memory picker) ──
            // Self-only: the OWNER's own entry photos across ALL their visits to a
            // restaurant, to feed the Top-4 hero picker. Caller-scoped (user.id) —
            // never accepts a target user. Any visibility (they are the owner).
            // Doctrine: never any other image source (no restaurants.photo_url,
            // no Places, no other users' photos).
            if (postAction === 'my_restaurant_photos') {
                const { restaurant_id } = body as { restaurant_id?: string };
                if (!restaurant_id) return errResponse('BAD_REQUEST', 'restaurant_id is required');

                const { data, error } = await supabase
                    .from('entry_photos')
                    .select('id, photo_url, created_at, entries!inner(user_id, restaurant_id)')
                    .eq('entries.user_id', user.id)
                    .eq('entries.restaurant_id', restaurant_id)
                    .not('photo_url', 'is', null)
                    .order('created_at', { ascending: false });

                if (error) return errResponse('DB_ERROR', error.message, 500);

                return jsonResponse({
                    data: {
                        photos: (data ?? []).map((r: any) => ({
                            entry_photo_id: r.id,
                            photo_url: r.photo_url,
                        })),
                    },
                });
            }

            return errResponse('BAD_REQUEST', `Unknown POST action: ${postAction}`);
        }

        return errResponse('METHOD_NOT_ALLOWED', 'Only GET and POST are supported', 405);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[top-fours] Unexpected error:', message);
        reportError(err, { fn: 'top-fours' });
        return errResponse('INTERNAL_ERROR', 'An unexpected error occurred', 500);
    }
});
