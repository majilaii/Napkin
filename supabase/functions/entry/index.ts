import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { reportError } from '../_shared/report.ts';
import { upsertRestaurant } from '../_shared/restaurant.ts';
import { errorResponse, mapPgError } from '../_shared/errors.ts';
import { emitFriendLogged } from '../_shared/notify.ts';
import { coerceClientNonce } from '../_shared/uuid.ts';
import { normalizeMergeImagePayload } from './mergeImagePayload.ts';

/**
 * Entry Edge Function
 *
 * Creates unified meal log entries. Can reference:
 * - restaurant_id: For restaurant entries (counts as restaurant review)
 * - place_id: For non-restaurant Google Places (parks, etc.)
 * - user_place_id: For saved places (Home, Grandma's)
 * - None: Just a meal log with no location
 *
 * POST actions:
 * - (no action): Create a new entry, optionally tagging participant_ids or companion_ids
 * - add-take: Update the caller's entry_participants row with their rating/notes
 * - update-companions: Replace the companion set for an entry the caller owns
 *
 * NOTE: entry_companions (companion tagging) and entry_participants (Round ratings)
 * are DISTINCT tables. Do NOT overload entry_participants for companion tagging.
 * participants = Round ratings/notes; companions = tagged presence on solo logs.
 */

// Food establishment types from Google Places
const FOOD_TYPES = ['restaurant', 'cafe', 'bar', 'bakery', 'meal_takeaway', 'food', 'meal_delivery'];

// TICKET-159 stray-log stitch: the suggest-only candidacy, computed by ONE SQL
// RPC (fn_supper_stitch_suggestion) so the fresh-create and dedup paths can
// never drift. Returns the single best suggestion or null. Best-effort — a
// suggestion failure must NEVER fail the entry create (log-and-null).
interface SupperSuggestion {
    supper_id: string;
    restaurant_name: string | null;
    gathered_count: number;
    /** 'YYYY-MM-DD' — the supper's night (gather_on for gather-born, else created day, HKT). */
    night: string;
}

async function fetchSupperSuggestion(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    userId: string,
    restaurantId: string,
    visitedAt: string,
    entryId: string,
): Promise<SupperSuggestion | null> {
    try {
        const { data, error } = await supabase.rpc('fn_supper_stitch_suggestion', {
            p_user: userId,
            p_restaurant_id: restaurantId,
            p_visited_at: visitedAt,
            p_entry_id: entryId,
        });
        if (error) {
            console.error('[entry] fn_supper_stitch_suggestion failed (non-fatal):', error);
            return null;
        }
        const row = Array.isArray(data) ? data[0] : data;
        if (!row?.supper_id) return null;
        return {
            supper_id: row.supper_id,
            restaurant_name: row.restaurant_name ?? null,
            gathered_count: typeof row.gathered_count === 'number' ? row.gathered_count : 0,
            night: row.night,
        };
    } catch (e) {
        console.error('[entry] fn_supper_stitch_suggestion threw (non-fatal):', e);
        return null;
    }
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Missing Authorization header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const token = authHeader.replace('Bearer ', '');
        // Use service role key to bypass RLS - we validate auth manually via getUser
        const supabase = createClient(
            supabaseUrl ?? '',
            supabaseServiceKey ?? ''
        );

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // ── GET: merge_candidate ───────────────────────────────────────────────
        // Returns the most recent entry in the target Table that:
        //   - Matches the given restaurant_id
        //   - Was authored by a different member
        //   - Has visited_at within ±18h of the given visited_at
        //   - Is NOT already bound to any round (merged OR live)
        // Returns null if no candidate exists (silent — no card shown).
        //
        // TICKET-044: [ARCH-REVIEW] verified — both halves of the "not in any round"
        // predicate are present: id NOT IN round_entries AND table_night_id IS NULL.
        if (req.method === 'GET') {
            const url = new URL(req.url);
            const action = url.searchParams.get('action');

            if (action === 'merge_candidate') {
                const tableId = url.searchParams.get('table_id');
                const restaurantId = url.searchParams.get('restaurant_id');
                const visitedAtStr = url.searchParams.get('visited_at');

                if (!tableId || !restaurantId || !visitedAtStr) {
                    return new Response(
                        JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'table_id, restaurant_id, visited_at are required' } }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                // Validate caller is a member of the table (member_id doctrine)
                const { data: membership } = await supabase
                    .from('table_members')
                    .select('member_id')
                    .eq('table_id', tableId)
                    .eq('member_id', user.id)
                    .single();

                if (!membership) {
                    return new Response(
                        JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Not a member of this table' } }),
                        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                const visitedAt = new Date(visitedAtStr).toISOString();
                // ±18h window in seconds
                const windowSecs = 18 * 3600;

                // Find the most recent candidate entry in this table that:
                //   1. Is shared to this table (entry_tables)
                //   2. Matches the restaurant
                //   3. Is within ±18h of the composer's visited_at
                //   4. Was authored by a different member
                //   5. Has table_night_id IS NULL (not in a live round)
                //   6. Is NOT in round_entries (not in a merged round)
                const { data: candidates, error: candErr } = await supabase
                    .from('entry_tables')
                    .select(`
                        entry_id,
                        entries:entry_id (
                            id,
                            user_id,
                            rating,
                            restaurant_id,
                            visited_at,
                            created_at,
                            table_night_id
                        )
                    `)
                    .eq('table_id', tableId)
                    .limit(50); // fetch a batch; filter JS-side for window + round membership

                if (candErr) throw candErr;

                const windowMs = windowSecs * 1000;
                const composerDate = new Date(visitedAt).getTime();

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const rawCandidates = (candidates ?? []) as any[];
                const filtered: {
                    id: string;
                    user_id: string;
                    rating: number | null;
                    visited_at: string;
                    created_at: string;
                    display_name: string;
                    avatar_url: string | null;
                }[] = [];

                for (const row of rawCandidates) {
                    const entry = Array.isArray(row.entries) ? row.entries[0] : row.entries;
                    if (!entry) continue;
                    if (entry.restaurant_id !== restaurantId) continue;
                    if (entry.user_id === user.id) continue;
                    if (entry.table_night_id !== null) continue;
                    const entryDate = new Date(entry.visited_at ?? entry.created_at).getTime();
                    if (Math.abs(composerDate - entryDate) > windowMs) continue;

                    filtered.push({
                        id: entry.id,
                        user_id: entry.user_id,
                        rating: entry.rating ?? null,
                        visited_at: entry.visited_at ?? entry.created_at,
                        created_at: entry.created_at,
                        // Author profile filled in below (entries has no FK to profiles
                        // to embed, so we batch-fetch the chosen candidate's profile).
                        display_name: 'User',
                        avatar_url: null,
                    });
                }

                if (filtered.length === 0) {
                    return new Response(
                        JSON.stringify({ data: null }),
                        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                // Sort by visited_at DESC, created_at DESC — most recent first
                filtered.sort((a, b) => {
                    const diff = new Date(b.visited_at).getTime() - new Date(a.visited_at).getTime();
                    if (diff !== 0) return diff;
                    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                });

                // Filter out any candidate already bound to a merged round.
                // The merge RPC's commit-time recheck is the authoritative gate, but
                // dropping bound candidates here keeps the card silent for already-merged entries.
                const candidateIds = filtered.map((c) => c.id);
                const { data: bound } = await supabase
                    .from('round_entries')
                    .select('entry_id')
                    .in('entry_id', candidateIds);
                const boundSet = new Set((bound ?? []).map((r: { entry_id: string }) => r.entry_id));
                const top = filtered.find((c) => !boundSet.has(c.id));

                if (!top) {
                    return new Response(
                        JSON.stringify({ data: null }),
                        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                // entries has no FK to profiles, so the author's profile can't be
                // embedded (it 400s). Fetch the chosen candidate's profile directly.
                const { data: topProfile } = await supabase
                    .from('profiles')
                    .select('display_name, avatar_url')
                    .eq('user_id', top.user_id)
                    .maybeSingle();

                return new Response(
                    JSON.stringify({
                        data: {
                            entry_id: top.id,
                            user_id: top.user_id,
                            rating: top.rating,
                            visited_at: top.visited_at,
                            display_name: topProfile?.display_name ?? 'User',
                            avatar_url: topProfile?.avatar_url ?? null,
                        }
                    }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // ── GET: supper-detail (TICKET-082) ────────────────────────────────
            // Returns { supper, roster, takes } for one Supper. The caller MUST be a
            // supper member (host or supper_members row) — else a generic 404 (no
            // enumeration). Returns nested in `data` (callEdgeFn strips the envelope).
            //
            // SECURITY (Codex Phase-2 carry-forward, migration header lines 17-19):
            //   The service-role client BYPASSES RLS — can_view_entry branch 5 does NOT
            //   protect this read path. The `takes` query MUST filter
            //   `user_id IN (<member ids>)` so a stranger who set supper_id on their own
            //   entry (client-writable group key) cannot leak into the supper. This
            //   mirrors the branch-5 author-membership conjunct at the application layer.
            if (action === 'supper-detail') {
                const supperId = url.searchParams.get('supper_id');
                if (!supperId) {
                    return new Response(
                        JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'supper_id is required' } }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }
                // Codex Phase-2 review: reject a malformed supper_id with a clean 400
                // rather than letting the uuid cast 500 downstream.
                if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(supperId)) {
                    return new Response(
                        JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'supper_id is malformed' } }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                // Roster = the trust anchor. We read it first; caller-membership is then
                // a membership check against this set (host is included via the seed at
                // creation, so a roster row always exists for the host too).
                const { data: rosterRows, error: rosterErr } = await supabase
                    .from('supper_members')
                    .select(`
                        user_id,
                        created_at,
                        profiles:user_id (
                            display_name,
                            avatar_url
                        )
                    `)
                    .eq('supper_id', supperId);
                if (rosterErr) throw rosterErr;

                const memberIds = (rosterRows ?? []).map((r: { user_id: string }) => r.user_id);

                // Membership gate. The host is always seeded into supper_members at
                // creation, but defend in depth: also accept suppers.host_user_id.
                let isMember = memberIds.includes(user.id);
                if (!isMember) {
                    const { data: hostRow } = await supabase
                        .from('suppers')
                        .select('host_user_id')
                        .eq('id', supperId)
                        .maybeSingle();
                    isMember = hostRow?.host_user_id === user.id;
                }
                if (!isMember) {
                    // Generic 404 — a non-member learns nothing about whether the
                    // supper exists.
                    return new Response(
                        JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Supper not found' } }),
                        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                // Supper anchor.
                const { data: supperRow, error: supperFetchErr } = await supabase
                    .from('suppers')
                    .select('id, restaurant_id, host_user_id, table_id, created_at')
                    .eq('id', supperId)
                    .single();
                if (supperFetchErr || !supperRow) {
                    return new Response(
                        JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Supper not found' } }),
                        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                // Takes = entries in this supper authored by a MEMBER. The
                // `user_id IN (memberIds)` filter is MANDATORY — without it, service-role
                // RLS-bypass would surface a stranger's entry that merely set supper_id.
                let takeRows: unknown[] = [];
                if (memberIds.length > 0) {
                    const { data: takesData, error: takesErr } = await supabase
                        .from('entries')
                        .select(`
                            id,
                            user_id,
                            restaurant_id,
                            supper_id,
                            rating,
                            content,
                            dish_description,
                            visited_at,
                            created_at,
                            vibe_rating,
                            flavor_rating,
                            service_rating,
                            value_rating,
                            liked,
                            photo_url,
                            entry_photos (
                                photo_url,
                                sort_order
                            )
                        `)
                        .eq('supper_id', supperId)
                        .in('user_id', memberIds)
                        .order('created_at', { ascending: true });
                    if (takesErr) throw takesErr;
                    takeRows = takesData ?? [];
                }

                // Normalize the PostgREST embeds (single-object vs array shape drift).
                const roster = (rosterRows ?? []).map((r: any) => {
                    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
                    return {
                        user_id: r.user_id,
                        display_name: p?.display_name ?? null,
                        avatar_url: p?.avatar_url ?? null,
                        created_at: r.created_at,
                    };
                });

                // entries has NO foreign key to profiles (only entries.user_id ->
                // auth.users), so PostgREST cannot embed `profiles:user_id` off entries
                // — it 400s, which is what 500'd this whole action. Every taker is a
                // supper member, so source their profile from the roster we already
                // fetched (no extra round-trip).
                const profileByUserId = new Map(roster.map((r) => [r.user_id, r]));
                const takes = (takeRows as any[]).map((t) => {
                    const p = profileByUserId.get(t.user_id);
                    const photos = Array.isArray(t.entry_photos)
                        ? [...t.entry_photos].sort(
                            (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order,
                          )
                        : [];
                    return {
                        entry_id: t.id,
                        user_id: t.user_id,
                        restaurant_id: t.restaurant_id,
                        supper_id: t.supper_id,
                        rating: t.rating,
                        content: t.content,
                        dish_description: t.dish_description,
                        visited_at: t.visited_at,
                        created_at: t.created_at,
                        vibe_rating: t.vibe_rating,
                        flavor_rating: t.flavor_rating,
                        service_rating: t.service_rating,
                        value_rating: t.value_rating,
                        liked: t.liked,
                        photo_url: t.photo_url,
                        photos: photos.map((ph: { photo_url: string }) => ph.photo_url),
                        display_name: p?.display_name ?? null,
                        avatar_url: p?.avatar_url ?? null,
                    };
                });

                // Restaurant — the supper is restaurant-anchored, so the gathered view
                // needs name/city/photo (the supper anchor only carries restaurant_id).
                const { data: supperRestaurant } = await supabase
                    .from('restaurants')
                    .select('id, name, city, photo_url')
                    .eq('id', supperRow.restaurant_id)
                    .maybeSingle();

                // TICKET-159 provenance: a supper born from a gather shows its
                // lineage (`planned <created_at> · gathered <gather_on>`). The
                // reverse lookup rides idx_gatherings_one_supper (≤1 row); a
                // set-a-table supper (no gather) yields null → no lineage line.
                const { data: lineageRow, error: lineageErr } = await supabase
                    .from('gatherings')
                    .select('created_at, gather_on')
                    .eq('supper_id', supperId)
                    .maybeSingle();
                if (lineageErr) throw lineageErr;
                const lineage = lineageRow
                    ? { planned: lineageRow.created_at, gathered: lineageRow.gather_on }
                    : null;

                return new Response(
                    JSON.stringify({
                        data: {
                            supper: supperRow,
                            restaurant: supperRestaurant ?? null,
                            roster,
                            takes,
                            lineage,
                        },
                    }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            return new Response(
                JSON.stringify({ error: 'Method not allowed' }),
                { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        if (req.method === 'POST') {
            const body = await req.json();
            console.log('entry function called with body:', JSON.stringify(body));

            // ── upsert_restaurant action ───────────────────────────────────
            // Persists a ghost Places result to the restaurants table without
            // creating an entry. Used by TICKET-015 (wishlist) and TICKET-017 (search).
            if (body.action === 'upsert_restaurant') {
                const { restaurant: rInput } = body;
                if (!rInput?.external_id || !rInput?.name) {
                    return new Response(
                        JSON.stringify({ error: 'restaurant.external_id and restaurant.name are required' }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                    );
                }

                const restaurantId = await upsertRestaurant(supabase, {
                    external_id: rInput.external_id,
                    name: rInput.name,
                    location: {
                        address: rInput.location?.address ?? rInput.formattedAddress ?? undefined,
                        locality: rInput.location?.locality ?? rInput.city ?? undefined,
                        country: rInput.location?.country ?? rInput.country ?? undefined,
                    },
                    types: rInput.types ?? rInput.categories,
                    latitude: rInput.latitude,
                    longitude: rInput.longitude,
                    photoReference: rInput.photoReference,
                    // TICKET-057: see entry-create path comment below; same contract.
                    photoAttributionHtml: rInput.photoAttributionHtml ?? null,
                    googleRating: rInput.googleRating ?? rInput.rating,
                    googleRatingCount: rInput.googleRatingCount ?? rInput.userRatingCount,
                    priceLevel: rInput.priceLevel,
                    cuisine: rInput.cuisine,
                    // TICKET-081: pass metadata through if the client carries it (additive).
                    phone: rInput.phone,
                    website: rInput.website,
                    googleMapsUri: rInput.googleMapsUri ?? rInput.google_maps_uri,
                    hours: rInput.hours,
                });

                return new Response(
                    JSON.stringify({ data: { id: restaurantId } }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                );
            }

            // ── append_entry_photo action ──────────────────────────────────
            // Delegates to append_entry_photo RPC for server-side sort_order
            // computation. Eliminates the client read-then-write race (P1-1).
            // Storage orphan cleanup is performed here (not in the RPC) because
            // RPCs cannot call HTTP APIs.
            if (body.action === 'append_entry_photo') {
                const { entry_id, photo_url: appendPhotoUrl } = body;

                if (!entry_id || typeof entry_id !== 'string') {
                    return new Response(
                        JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'entry_id is required' } }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }
                if (!appendPhotoUrl || typeof appendPhotoUrl !== 'string') {
                    return new Response(
                        JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'photo_url is required' } }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                let rpcResult: unknown;
                try {
                    const { data: rpcData, error: rpcErr } = await supabase.rpc('append_entry_photo', {
                        p_entry_id:  entry_id,
                        p_user_id:   user.id,
                        p_photo_url: appendPhotoUrl,
                    });
                    if (rpcErr) throw rpcErr;
                    rpcResult = rpcData;
                } catch (err: any) {
                    const { code, status } = mapPgError(err);
                    return errorResponse(code, err.message ?? 'append_entry_photo failed', status);
                }

                return new Response(
                    JSON.stringify({ data: rpcResult }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // ── moderated image lifecycle mutations ──────────────────────
            // These service-only RPCs keep sink changes and image-ref changes in
            // the same database transaction.  B-1 clients route here before B-2
            // removes the legacy direct grants; delete triggers remain the
            // correctness net for old clients and cascades.
            if (body.action === 'set_entry_hero') {
                const entryId = typeof body.entry_id === 'string' ? body.entry_id : '';
                const photoUrl = body.photo_url == null ? null : String(body.photo_url).trim();
                if (!entryId) {
                    return errorResponse('INVALID_INPUT', 'entry_id is required', 400);
                }
                if (photoUrl !== null && !photoUrl) {
                    return errorResponse('INVALID_INPUT', 'photo_url must be a URL or null', 400);
                }

                const { data, error } = await supabase.rpc('fn_set_entry_hero', {
                    p_user_id: user.id,
                    p_entry_id: entryId,
                    p_photo_url: photoUrl,
                });
                if (error) {
                    const { code, status } = mapPgError(error);
                    return errorResponse(code, error.message ?? 'set_entry_hero failed', status);
                }
                return new Response(JSON.stringify({ data }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }

            if (body.action === 'delete_entry_photo') {
                const photoId = typeof body.photo_id === 'string' ? body.photo_id : '';
                if (!photoId) {
                    return errorResponse('INVALID_INPUT', 'photo_id is required', 400);
                }
                const { data, error } = await supabase.rpc('fn_delete_entry_photo', {
                    p_user_id: user.id,
                    p_photo_id: photoId,
                });
                if (error) {
                    const { code, status } = mapPgError(error);
                    return errorResponse(code, error.message ?? 'delete_entry_photo failed', status);
                }
                return new Response(JSON.stringify({ data }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }

            if (body.action === 'delete_entry') {
                const entryId = typeof body.entry_id === 'string' ? body.entry_id : '';
                if (!entryId) {
                    return errorResponse('INVALID_INPUT', 'entry_id is required', 400);
                }
                const { data, error } = await supabase.rpc('fn_delete_entry', {
                    p_user_id: user.id,
                    p_entry_id: entryId,
                });
                if (error) {
                    const { code, status } = mapPgError(error);
                    return errorResponse(code, error.message ?? 'delete_entry failed', status);
                }
                return new Response(JSON.stringify({ data }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }

            // ── update-companions action ───────────────────────────────────
            // Replace the full companion set for an entry the caller owns.
            // Receives: { action: 'update-companions', entry_id, companion_ids[] }
            if (body.action === 'update-companions') {
                const { entry_id, companion_ids } = body;

                if (!entry_id || typeof entry_id !== 'string') {
                    return new Response(
                        JSON.stringify({ error: 'entry_id is required' }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                // Verify caller owns the entry
                const { data: ownerCheck, error: ownerErr } = await supabase
                    .from('entries')
                    .select('id')
                    .eq('id', entry_id)
                    .eq('user_id', user.id)
                    .single();

                if (ownerErr || !ownerCheck) {
                    return new Response(
                        JSON.stringify({ error: 'Entry not found or not owned by caller' }),
                        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                // Sanitize companion ids: array, exclude self, dedupe
                const rawIds: string[] = Array.isArray(companion_ids) ? companion_ids : [];
                const sanitized = [...new Set(rawIds.filter((id: string) => id && id !== user.id))];

                // Replace: delete old rows then insert new ones (atomic enough for this use case)
                const { error: deleteErr } = await supabase
                    .from('entry_companions')
                    .delete()
                    .eq('entry_id', entry_id);

                if (deleteErr) throw deleteErr;

                if (sanitized.length > 0) {
                    const rows = sanitized.map((uid: string) => ({
                        entry_id,
                        user_id: uid,
                    }));
                    const { error: insertErr } = await supabase
                        .from('entry_companions')
                        .insert(rows);
                    if (insertErr) throw insertErr;
                }

                return new Response(
                    JSON.stringify({ data: { entry_id, companion_ids: sanitized } }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // ── set-table action (Supper v2 — "the empty table") ───────────
            // Create a supper WITHOUT any review: the anchor (restaurant + Table +
            // host) + the roster of seats. Everyone, INCLUDING the host, starts as an
            // empty seat; takes attach later via `add-take`. This is the v2 create
            // path — it replaces the old "log a meal + make-this-a-Supper toggle"
            // (which opened a supper on the host's review). No entry is created here.
            // Receives: { action: 'set-table', table_id, restaurant_id, member_ids[] }
            if (body.action === 'set-table') {
                const { table_id: stTableId, restaurant_id: stRestaurantId } = body;
                const rawMemberIds: string[] = Array.isArray(body.member_ids) ? body.member_ids : [];

                const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                if (!stTableId || typeof stTableId !== 'string' || !stRestaurantId || typeof stRestaurantId !== 'string') {
                    return new Response(
                        JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'table_id and restaurant_id are required' } }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }
                // Validate UUID shape up front (mirrors supper-detail/add-take) so a
                // malformed id returns a clean 400 instead of masquerading as a 403.
                if (!UUID_RE.test(stTableId) || !UUID_RE.test(stRestaurantId)) {
                    return new Response(
                        JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'table_id or restaurant_id is malformed' } }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                // Caller must be a member of the Table (member_id doctrine, NOT user_id).
                // Destructure `error` and 500 on a real DB failure — a swallowed error here
                // would masquerade as a 403 "not a member" (see table-activity gate doctrine).
                const { data: stMembership, error: stMembershipErr } = await supabase
                    .from('table_members')
                    .select('member_id')
                    .eq('table_id', stTableId)
                    .eq('member_id', user.id)
                    .maybeSingle();
                if (stMembershipErr) throw stMembershipErr;
                if (!stMembership) {
                    return new Response(
                        JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Not a member of this table' } }),
                        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                // The supper is restaurant-anchored — the restaurant must already exist
                // (the client persists a ghost via upsert_restaurant before setting a table).
                const { data: stRestaurant, error: stRestaurantErr } = await supabase
                    .from('restaurants')
                    .select('id')
                    .eq('id', stRestaurantId)
                    .maybeSingle();
                if (stRestaurantErr) throw stRestaurantErr;
                if (!stRestaurant) {
                    return new Response(
                        JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'restaurant not found' } }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                // Crew = caller + picked member_ids, all of whom MUST be members of this
                // Table (a supper's roster is drawn from its Table). Exclude self, then
                // validate against table_members and drop non-members. CRITICAL: throw on a
                // DB error here — swallowing it would fail OPEN (empty validSet → all crew
                // dropped → a host-only supper created on a transient blip, reporting 200).
                let crew = [...new Set(rawMemberIds.filter((id: string) => id && id !== user.id))];
                if (crew.length > 0) {
                    const { data: crewMembers, error: crewErr } = await supabase
                        .from('table_members')
                        .select('member_id')
                        .eq('table_id', stTableId)
                        .in('member_id', crew);
                    if (crewErr) throw crewErr;
                    const validSet = new Set((crewMembers ?? []).map((m: { member_id: string }) => m.member_id));
                    crew = crew.filter((id) => validSet.has(id));
                }
                const roster = [user.id, ...crew];

                // Insert the anchor (table-scoped), then seed supper_members. On any
                // failure, roll back so no partial supper survives (delete cascades members).
                let stSupperId: string | null = null;
                try {
                    const { data: stSupperRow, error: stSupperErr } = await supabase
                        .from('suppers')
                        .insert({ restaurant_id: stRestaurantId, host_user_id: user.id, table_id: stTableId })
                        .select('id, restaurant_id, host_user_id, table_id, created_at')
                        .single();
                    if (stSupperErr) throw stSupperErr;
                    stSupperId = stSupperRow.id;

                    const { error: stMembersErr } = await supabase
                        .from('supper_members')
                        .insert(roster.map((uid) => ({ supper_id: stSupperId, user_id: uid })));
                    if (stMembersErr) throw stMembersErr;

                    return new Response(
                        JSON.stringify({ data: { ...stSupperRow, member_count: roster.length } }),
                        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                } catch (setTableErr) {
                    console.error('[entry] set-table failed, rolling back:', setTableErr);
                    if (stSupperId) {
                        await supabase.from('suppers').delete().eq('id', stSupperId);
                    }
                    return new Response(
                        JSON.stringify({ error: { code: 'set_table_failed', message: 'Could not set the table' } }),
                        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }
            }

            // ── delete-supper action (TICKET-161) ──────────────────────────
            // The HOST deletes a supper card. Takes are NOT orphaned into privacy:
            // for a v2 supper (table_id set) we RE-HOME every roster-authored take as
            // an individual review still visible in the Table feed, by inserting an
            // entry_tables (entry_id, table_id, posted_at = the take's created_at)
            // share edge BEFORE deleting the anchor. Deleting the anchor cascades
            // supper_members and fires entries.supper_id → NULL / gatherings.supper_id
            // → NULL via the existing FKs, so the suppers_stream card vanishes and each
            // take resurfaces as an ordinary entry card at its original created_at sort
            // position (can_view_entry branch 2 grants tablemate visibility). The
            // re-home is purely an added share edge — take `entries` rows are NEVER
            // mutated (rating/note/photos/visited_at untouched). No migration: every FK
            // the delete relies on is already correct.
            //
            // ORDERING (insert entry_tables first, delete anchor last) is the only
            // ordering that satisfies the concurrency + retry ACs simultaneously. While
            // the anchor still exists, the entries_stream suppression clause
            // (NOT EXISTS suppers s WHERE s.id = e.supper_id AND s.table_id = p_table_id)
            // hides re-homed takes even though their entry_tables row now exists — the
            // suppers_stream card stays the sole representative, so there is NO window
            // where a take is both suppressed-as-take and visible-as-entry. The instant
            // the anchor is deleted the suppression predicate goes false and the take
            // surfaces. A failed delete after successful inserts is retry-safe: the
            // upsert ON CONFLICT (entry_id, table_id) DO NOTHING no-ops.
            //
            // SECURITY: the service-role client BYPASSES RLS. Host-only —
            // suppers.host_user_id === caller — and every other caller (fellow supper
            // member, outside table member, stranger, malformed id, already-deleted row)
            // gets the SAME generic 404 (mirrors supper-detail; no supper-id
            // enumeration). The re-home read is roster-scoped (user_id IN (roster)) so a
            // stranger who set supper_id on their own entry (client-writable group key)
            // cannot be re-homed into the Table (mirrors the branch-5 conjunct).
            if (body.action === 'delete-supper') {
                const dsSupperId = body.supper_id;
                const DS_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                if (!dsSupperId || typeof dsSupperId !== 'string' || !DS_UUID_RE.test(dsSupperId)) {
                    return new Response(
                        JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'supper_id is malformed' } }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                // Fetch the anchor. A missing row → generic 404 (no enumeration). A
                // non-host → the SAME generic 404 (never distinguishes "not yours" from
                // "doesn't exist"). A double-delete lands here too (row already gone) →
                // 404, which the hook treats as benign already-gone.
                const { data: dsSupper, error: dsSupperErr } = await supabase
                    .from('suppers')
                    .select('id, host_user_id, table_id')
                    .eq('id', dsSupperId)
                    .maybeSingle();
                if (dsSupperErr) throw dsSupperErr;
                if (!dsSupper || dsSupper.host_user_id !== user.id) {
                    return new Response(
                        JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Supper not found' } }),
                        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                // Re-home only applies to a v2 supper (a Table to attach to). Legacy v1
                // (table_id NULL) has nothing to re-home onto — its takes detach to
                // private-solo via entries.supper_id ON DELETE SET NULL.
                const dsTableId: string | null = dsSupper.table_id ?? null;
                if (dsTableId) {
                    // Roster = the trust anchor (service-role-write-only supper_members).
                    const { data: dsRosterRows, error: dsRosterErr } = await supabase
                        .from('supper_members')
                        .select('user_id')
                        .eq('supper_id', dsSupperId);
                    if (dsRosterErr) throw dsRosterErr;
                    const dsRoster = (dsRosterRows ?? []).map((r: { user_id: string }) => r.user_id);

                    // Empty-roster guard (parity with supper-detail): only read takes /
                    // build entry_tables when there's a roster to scope the read to. A
                    // `.in('user_id', [])` would be a degenerate query.
                    if (dsRoster.length > 0) {
                        // Roster-scoped read — MANDATORY. Service-role bypasses RLS, so
                        // without user_id IN (roster) a stranger who set supper_id on
                        // their own entry would leak into the Table on re-home.
                        const { data: dsTakes, error: dsTakesErr } = await supabase
                            .from('entries')
                            .select('id, created_at')
                            .eq('supper_id', dsSupperId)
                            .in('user_id', dsRoster);
                        if (dsTakesErr) throw dsTakesErr;

                        const dsTakeRows = (dsTakes ?? []) as { id: string; created_at: string }[];
                        if (dsTakeRows.length > 0) {
                            // posted_at = the take's created_at, EXPLICITLY (never the
                            // column's now() default) — entries_stream sorts by
                            // et.posted_at; the default would stamp delete-time and shove
                            // every take to the top of the feed as "new". Matches the
                            // 20260509 backfill + the mirror trigger, both of which use
                            // created_at. (This direct insert does NOT touch
                            // entries.table_id, so trg_entries_mirror_table_id_to_join
                            // never fires and cannot interfere.)
                            const dsEntryTableRows = dsTakeRows.map((t) => ({
                                entry_id: t.id,
                                table_id: dsTableId,
                                posted_at: t.created_at,
                            }));
                            // upsert with ignoreDuplicates — supabase-js .insert() has NO
                            // on-conflict support; a duplicate throws 23505 and silently
                            // breaks the retry-safety AC. PK is (entry_id, table_id).
                            const { error: dsUpsertErr } = await supabase
                                .from('entry_tables')
                                .upsert(dsEntryTableRows, { onConflict: 'entry_id,table_id', ignoreDuplicates: true });
                            if (dsUpsertErr) throw dsUpsertErr;
                        }
                    }
                }

                // Delete the anchor LAST. Cascades supper_members; fires
                // entries.supper_id → NULL and gatherings.supper_id → NULL via the FKs.
                // The suppers_stream card vanishes; re-homed takes surface via their new
                // entry_tables row (the suppression predicate is now false).
                const { error: dsDeleteErr } = await supabase
                    .from('suppers')
                    .delete()
                    .eq('id', dsSupperId);
                if (dsDeleteErr) throw dsDeleteErr;

                // { deleted: true } nested INSIDE data (callEdgeFn strips the envelope).
                return new Response(
                    JSON.stringify({ data: { deleted: true } }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // ── merge_with action ──────────────────────────────────────────
            // Creates B's entry AND binds A's entry + B's entry to a new merged round
            // atomically via fn_create_entry_and_merge_round.
            //
            // On round_conflict (concurrent merge race, A's entry deleted, A left Table, etc.)
            // the server falls back to fn_create_entry_with_tables with the same client_nonce
            // and returns merge_outcome: 'conflict_fell_back'.
            //
            // Response: { data: { ...entry }, merge_outcome: 'merged' | 'conflict_fell_back' | 'solo' }
            //
            // [ARCH-REVIEW] verified:
            //   - fn_create_entry_and_merge_round validates BOTH round_entries and
            //     table_night_id IS NULL predicates at commit time.
            //   - client_nonce idempotency is handled inside the RPC.
            //   - No auth.uid() in the RPC.
            if (body.action === 'merge_with') {
                const {
                    entry_a_id,
                    table_id: mergeTableId,
                    restaurant_id: mergeRestaurantId,
                    visited_at: mergeVisitedAt,
                    client_nonce: mergeClientNonce,
                    // B's full entry payload (same shape as the default create-entry path)
                    rating: mRating,
                    content: mContent,
                    dish_description: mDishDesc,
                    visited_at: mVisitedAt,
                    visibility: mVisibility,
                    vibe_rating: mVibeRating,
                    flavor_rating: mFlavorRating,
                    service_rating: mServiceRating,
                    value_rating: mValueRating,
                    photo_url: mPhotoUrl,
                    photo_urls: mPhotoUrls,
                } = body;

                // Coerce a possibly-malformed client nonce (RN runtimes lacking
                // crypto.randomUUID send `Date.now()-Math.random()` → not a uuid).
                const safeMergeNonce = await coerceClientNonce(mergeClientNonce);

                if (!entry_a_id || !mergeTableId || !mergeRestaurantId || !mergeVisitedAt) {
                    return new Response(
                        JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'entry_a_id, table_id, restaurant_id, visited_at are required' } }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                // Validate caller is a member of the table
                const { data: mergeMembership } = await supabase
                    .from('table_members')
                    .select('member_id')
                    .eq('table_id', mergeTableId)
                    .eq('member_id', user.id)
                    .single();

                if (!mergeMembership) {
                    return new Response(
                        JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Not a member of this table' } }),
                        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                const mergeRatingValue = (mRating === 0 || mRating === undefined || mRating === null) ? null : mRating;
                const mergeVisitedAtValue = mergeVisitedAt
                    ? new Date(mergeVisitedAt).toISOString()
                    : new Date().toISOString();
                const mergeImages = normalizeMergeImagePayload({
                    photo_url: mPhotoUrl,
                    photo_urls: mPhotoUrls,
                });

                const bPayload = {
                    restaurant_id: mergeRestaurantId,
                    rating: mergeRatingValue,
                    content: mContent?.trim() || null,
                    dish_description: mDishDesc?.trim() || null,
                    visited_at: mergeVisitedAtValue,
                    visibility: mVisibility ?? 'private',
                    ...(mVibeRating != null ? { vibe_rating: mVibeRating } : {}),
                    ...(mFlavorRating != null ? { flavor_rating: mFlavorRating } : {}),
                    ...(mServiceRating != null ? { service_rating: mServiceRating } : {}),
                    ...(mValueRating != null ? { value_rating: mValueRating } : {}),
                    ...mergeImages,
                    ...(safeMergeNonce ? { client_nonce: safeMergeNonce } : {}),
                };

                let mergeOutcome: 'merged' | 'conflict_fell_back' | 'solo' = 'merged';
                let resultEntryId: string | null = null;
                let resultRoundId: string | null = null;

                try {
                    const { data: rpcData, error: rpcErr } = await supabase.rpc(
                        'fn_create_entry_and_merge_round',
                        {
                            p_actor_user_id: user.id,
                            p_table_id:      mergeTableId,
                            p_restaurant_id: mergeRestaurantId,
                            p_visited_at:    mergeVisitedAtValue,
                            p_entry_a_id:    entry_a_id,
                            p_b_payload:     bPayload,
                            p_client_nonce:  safeMergeNonce ?? null,
                        }
                    );

                    if (rpcErr) {
                        // round_conflict → fall back to solo save with same nonce
                        if (rpcErr.code === 'P0001' && rpcErr.message?.includes('round_conflict')) {
                            mergeOutcome = 'conflict_fell_back';
                        } else {
                            throw rpcErr;
                        }
                    } else {
                        const result = rpcData as { entry_b_id: string; round_id: string; was_dedup: boolean };
                        resultEntryId = result.entry_b_id;
                        resultRoundId = result.round_id;
                        mergeOutcome = 'merged';
                    }
                } catch (mergeErr: unknown) {
                    const errMsg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
                    if (errMsg.includes('round_conflict')) {
                        mergeOutcome = 'conflict_fell_back';
                    } else {
                        throw mergeErr;
                    }
                }

                // On conflict: fall back to fn_create_entry_with_tables with same nonce
                if (mergeOutcome === 'conflict_fell_back') {
                    const { data: fallbackResult, error: fallbackErr } = await supabase.rpc(
                        'fn_create_entry_with_tables',
                        {
                            p_user_id:        user.id,
                            p_entry:          bPayload,
                            p_table_ids:      [mergeTableId],
                            p_participant_ids: [user.id],
                            p_companion_ids:  null,
                        }
                    );
                    if (fallbackErr) throw fallbackErr;
                    const fallbackRow = Array.isArray(fallbackResult) ? fallbackResult[0] : fallbackResult;
                    resultEntryId = fallbackRow?.entry_id ?? fallbackRow?.id;
                }

                if (!resultEntryId) {
                    throw new Error('merge_with: no entry_id returned from RPC');
                }

                // Fetch the created entry for the response
                const { data: mergeEntryData } = await supabase
                    .from('entries')
                    .select('*')
                    .eq('id', resultEntryId)
                    .single();

                // Response shape matches hooks/rounds/useCreateEntryWithMerge.ts MergeResult.
                // merge_outcome is nested INSIDE data so callEdgeFn's envelope-strip preserves it.
                // restaurant/participants/average_rating omitted in v1 — the hook patches caches
                // from the input + optimistic state; activity invalidate refetches the
                // canonical projected round from fn_table_activity_page.
                return new Response(
                    JSON.stringify({
                        data: {
                            entry_id:      resultEntryId,
                            round_id:      resultRoundId,
                            entry_a_id,
                            table_id:      mergeTableId,
                            restaurant_id: mergeRestaurantId,
                            visited_at:    mergeEntryData?.visited_at ?? mergeVisitedAtValue,
                            created_at:    mergeEntryData?.created_at ?? new Date().toISOString(),
                            rating:        mergeEntryData?.rating ?? mergeRatingValue,
                            content:       mergeEntryData?.content ?? null,
                            average_rating: null,
                            restaurant:    null,
                            merge_outcome: mergeOutcome,
                        },
                    }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // ── attach-take action (TICKET-159 stray-log stitch) ───────────
            // Confirms a supper_suggestion: binds an EXISTING entry the caller
            // owns to a supper they belong to. ALL validation lives in the
            // locking SECDEF RPC (owner, membership, unattached, same
            // restaurant, no existing take) so a stale or manipulated
            // confirmation is rejected server-side. Never called by the server
            // on its own — the client's explicit confirm is the only trigger.
            if (body.action === 'attach-take') {
                const { entry_id: attachEntryId, supper_id: attachSupperId } = body;
                const ATTACH_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                if (typeof attachEntryId !== 'string' || !ATTACH_UUID_RE.test(attachEntryId) ||
                    typeof attachSupperId !== 'string' || !ATTACH_UUID_RE.test(attachSupperId)) {
                    return new Response(
                        JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'entry_id and supper_id are required' } }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                const { data: attachedRow, error: attachErr } = await supabase.rpc('fn_attach_take_to_supper', {
                    p_user: user.id,
                    p_entry_id: attachEntryId,
                    p_supper_id: attachSupperId,
                });
                if (attachErr) {
                    // attach_denied → 403, attach_conflict / 23505 → 409 (mapPgError).
                    const { code, status } = mapPgError(attachErr);
                    return errorResponse(code, attachErr.message ?? 'attach-take failed', status);
                }
                const attached = Array.isArray(attachedRow) ? attachedRow[0] : attachedRow;
                if (!attached?.id) {
                    throw new Error('attach-take: fn_attach_take_to_supper returned no entry');
                }

                return new Response(
                    JSON.stringify({ data: attached }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // ── add-take action ────────────────────────────────────────────
            if (body.action === 'add-take') {
                const { entry_id, rating, notes } = body;

                // ── TICKET-082: supper-take variant ──────────────────────────
                // When called with a supper_id, the caller adds THEIR OWN take to a
                // Supper: we validate membership (service-side — supper_members is the
                // trust anchor, NOT the client-writable entries.supper_id) and then
                // create the caller's own `entries` row with supper_id set. Each take
                // is its own entry (counts in the author's journal + restaurant history),
                // mirroring the normal create path via fn_create_entry_with_tables.
                const supperTakeId = body.supper_id;
                if (supperTakeId) {
                    // Codex Phase-2 review: malformed supper_id → clean 400, not a 500
                    // from the uuid cast in the membership query below.
                    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(supperTakeId)) {
                        return new Response(
                            JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'supper_id is malformed' } }),
                            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        );
                    }
                    // Validate rating if provided (same bounds as the legacy path).
                    if (rating !== null && rating !== undefined) {
                        if (typeof rating !== 'number' || rating < 0.5 || rating > 5.0) {
                            return new Response(
                                JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'Rating must be between 0.5 and 5.0' } }),
                                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                            );
                        }
                    }

                    // CRITICAL (security): the caller MUST already be a supper member.
                    // A non-member must not be able to add a take — supper_members is
                    // service-role-write-only, so this is the authoritative gate.
                    const { data: takeMembership, error: takeMemberErr } = await supabase
                        .from('supper_members')
                        .select('user_id')
                        .eq('supper_id', supperTakeId)
                        .eq('user_id', user.id)
                        .maybeSingle();
                    if (takeMemberErr) throw takeMemberErr;
                    if (!takeMembership) {
                        // Generic 403 — do not distinguish "no such supper" from
                        // "not a member" (no enumeration of supper ids).
                        return new Response(
                            JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Not a member of this supper' } }),
                            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        );
                    }

                    // Fetch the supper anchor for the restaurant_id (every take shares it).
                    const { data: supperAnchor, error: anchorErr } = await supabase
                        .from('suppers')
                        .select('restaurant_id')
                        .eq('id', supperTakeId)
                        .single();
                    if (anchorErr || !supperAnchor) {
                        return new Response(
                            JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Not a member of this supper' } }),
                            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        );
                    }

                    // TICKET-159 (one take per member per supper): pre-check so a
                    // double-tap never creates an orphan entry. The partial unique
                    // index idx_entries_one_take_per_supper is the authoritative
                    // race guard — its 23505 on the bind below maps to the same 409.
                    const { data: priorTake, error: priorTakeErr } = await supabase
                        .from('entries')
                        .select('id')
                        .eq('supper_id', supperTakeId)
                        .eq('user_id', user.id)
                        .maybeSingle();
                    if (priorTakeErr) throw priorTakeErr;
                    if (priorTake) {
                        return new Response(
                            JSON.stringify({ error: { code: 'ATTACH_CONFLICT', message: 'You already added your take to this supper' } }),
                            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        );
                    }

                    const {
                        content: takeContent,
                        dish_description: takeDish,
                        visited_at: takeVisitedAt,
                        visibility: takeVisibility,
                        vibe_rating: takeVibe,
                        flavor_rating: takeFlavor,
                        service_rating: takeService,
                        value_rating: takeValue,
                        liked: takeLiked,
                        photo_url: takePhotoUrl,
                        photo_urls: takePhotoUrls,
                        client_nonce: takeNonce,
                    } = body;

                    // Validate secondary ratings if provided.
                    for (const [name, val] of Object.entries({
                        vibe_rating: takeVibe, flavor_rating: takeFlavor,
                        service_rating: takeService, value_rating: takeValue,
                    })) {
                        if (val !== null && val !== undefined) {
                            if (typeof val !== 'number' || val < 0.5 || val > 5.0) {
                                return new Response(
                                    JSON.stringify({ error: { code: 'INVALID_INPUT', message: `${name} must be between 0.5 and 5.0` } }),
                                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                                );
                            }
                        }
                    }

                    const safeTakeNonce = await coerceClientNonce(takeNonce);
                    const takeRatingValue = (rating === 0 || rating === undefined || rating === null) ? null : rating;
                    const takeVisitedAtValue = takeVisitedAt
                        ? new Date(takeVisitedAt).toISOString()
                        : new Date().toISOString();
                    const takePhotoArray: string[] = Array.isArray(takePhotoUrls) ? takePhotoUrls : [];
                    const takeHeroPhoto = takePhotoUrl || takePhotoArray[0] || null;

                    const takePayload = {
                        restaurant_id: supperAnchor.restaurant_id,
                        rating: takeRatingValue,
                        content: (takeContent ?? notes)?.trim() || null,
                        dish_description: takeDish?.trim() || null,
                        visited_at: takeVisitedAtValue,
                        visibility: takeVisibility ?? 'private',
                        ...(takeVibe != null ? { vibe_rating: takeVibe } : {}),
                        ...(takeFlavor != null ? { flavor_rating: takeFlavor } : {}),
                        ...(takeService != null ? { service_rating: takeService } : {}),
                        ...(takeValue != null ? { value_rating: takeValue } : {}),
                        liked: takeLiked === true,
                        ...(takeHeroPhoto ? { photo_url: takeHeroPhoto } : {}),
                        ...(takePhotoArray.length > 0 ? { photo_urls: takePhotoArray } : {}),
                        ...(safeTakeNonce ? { client_nonce: safeTakeNonce } : {}),
                    };

                    // Create the caller's own entry via the canonical RPC (handles
                    // client_nonce dedup). No tables, only the author as participant.
                    const { data: takeRpc, error: takeRpcErr } = await supabase.rpc(
                        'fn_create_entry_with_tables',
                        {
                            p_user_id: user.id,
                            p_entry: takePayload,
                            p_table_ids: null,
                            p_participant_ids: [user.id],
                            p_companion_ids: null,
                        }
                    );
                    if (takeRpcErr) {
                        const { code, status } = mapPgError(takeRpcErr);
                        return errorResponse(code, takeRpcErr.message ?? 'add-take failed', status);
                    }
                    const takeRow = Array.isArray(takeRpc) ? takeRpc[0] : takeRpc;
                    const takeEntryId = takeRow?.entry_id ?? takeRow?.id;
                    if (!takeEntryId) {
                        throw new Error('add-take (supper): fn_create_entry_with_tables returned no entry_id');
                    }
                    const takeWasDedup = takeRow?.was_dedup === true;

                    // Bind the take entry to the supper (group key). The RPC does not
                    // carry supper_id, so we patch it here via service-role UPDATE.
                    // TICKET-159: idx_entries_one_take_per_supper turns a raced
                    // second bind into 23505 → clean 409 (the fresh orphan entry is
                    // removed so the loser leaves no stray log behind).
                    const { error: takeBindErr } = await supabase
                        .from('entries')
                        .update({ supper_id: supperTakeId })
                        .eq('id', takeEntryId);
                    if (takeBindErr) {
                        if ((takeBindErr as { code?: string }).code === '23505') {
                            if (!takeWasDedup) {
                                await supabase.from('entries').delete().eq('id', takeEntryId);
                            }
                            return new Response(
                                JSON.stringify({ error: { code: 'ATTACH_CONFLICT', message: 'You already added your take to this supper' } }),
                                { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                            );
                        }
                        throw takeBindErr;
                    }

                    // Photo rows and registry refs are created atomically by
                    // fn_create_entry_with_tables from p_entry.photo_urls.  Do
                    // not reintroduce a service-role insert here: it would bypass
                    // the enforcement flag and leave an untracked public object.

                    // Mark the author "been" at the restaurant (mirrors create path).
                    const { error: takeStatusErr } = await supabase
                        .from('user_restaurant_status')
                        .upsert({
                            user_id: user.id,
                            restaurant_id: supperAnchor.restaurant_id,
                            been: true,
                            want_to_try: false,
                            updated_at: new Date().toISOString(),
                        }, { onConflict: 'user_id,restaurant_id' });
                    if (takeStatusErr) {
                        console.error('[entry] supper take user_restaurant_status upsert error (non-fatal):', takeStatusErr);
                    }

                    // Fetch the created take row for the response.
                    const { data: takeEntryData } = await supabase
                        .from('entries')
                        .select('*')
                        .eq('id', takeEntryId)
                        .single();

                    // supper_id nested INSIDE data (callEdgeFn strips the outer envelope).
                    return new Response(
                        JSON.stringify({
                            data: {
                                ...(takeEntryData ?? { id: takeEntryId }),
                                supper_id: supperTakeId,
                            },
                            ...(takeWasDedup ? { warnings: [{ type: 'duplicate_submission' }] } : {}),
                        }),
                        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                if (!entry_id) {
                    return new Response(
                        JSON.stringify({ error: 'entry_id is required' }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                // Validate rating if provided
                if (rating !== null && rating !== undefined) {
                    if (typeof rating !== 'number' || rating < 0.5 || rating > 5.0) {
                        return new Response(
                            JSON.stringify({ error: 'Rating must be between 0.5 and 5.0' }),
                            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        );
                    }
                }

                // Validate user is a participant with null rating
                const { data: participant, error: partError } = await supabase
                    .from('entry_participants')
                    .select('rating')
                    .eq('entry_id', entry_id)
                    .eq('user_id', user.id)
                    .single();

                if (partError || !participant) {
                    return new Response(
                        JSON.stringify({ error: 'You are not a participant in this entry' }),
                        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                if (participant.rating !== null) {
                    return new Response(
                        JSON.stringify({ error: 'You have already added your take' }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                const ratingValue = (rating === 0 || rating === undefined || rating === null) ? null : rating;

                const { data: updated, error: updateError } = await supabase
                    .from('entry_participants')
                    .update({
                        rating: ratingValue,
                        notes: notes?.trim() || null,
                    })
                    .eq('entry_id', entry_id)
                    .eq('user_id', user.id)
                    .select()
                    .single();

                if (updateError) throw updateError;

                return new Response(
                    JSON.stringify({ data: updated }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // ── Create entry (default action) ──────────────────────────────
            const {
                // Location info (one of these)
                restaurant,      // { external_id, name, location, types, ... }
                place,           // { external_id, name, address, types, ... } for non-restaurant Google Places
                user_place_id,   // UUID for saved places (Home, etc.)
                restaurant_id,   // UUID of an already-persisted restaurant (solo-log path)
                place_id,        // UUID of an already-persisted place

                // Entry data
                rating,
                content,
                dish_description,
                cooked_by,
                value_profile,
                visited_at,

                // Secondary ratings (optional, 0.5–5.0)
                vibe_rating,
                flavor_rating,
                service_rating,
                value_rating,

                // TICKET-075: Letterboxd-style like (optional boolean; distinct from rating)
                liked,

                // User-uploaded photo(s) (optional, public URLs from Supabase Storage)
                photo_url,
                photo_urls,

                // Table sharing (optional)
                // TICKET-043: table_ids[] preferred; table_id is legacy (one release).
                // If both arrive, table_ids wins.
                table_id,
                table_ids: table_ids_raw,
                visibility,

                // Collaborative (optional)
                participant_ids,

                // Companion tagging (optional; distinct from participant_ids)
                // companion_ids = who was there; participant_ids = Round raters
                companion_ids,

                // TICKET-082 (Supper): when supper === true, this host entry opens a
                // shared-table meal. supper_participant_ids = the friends tagged to
                // (later) add their own take. The host is always seeded as a member.
                supper,
                supper_participant_ids,

                // Idempotency key (TICKET-036 wires client; RPC handles dedup)
                client_nonce,
            } = body;

            // TICKET-082: a Supper requires a restaurant (the anchor's restaurant_id
            // is NOT NULL). If supper is requested without a resolvable restaurant we
            // surface a clear 400 rather than 500ing on the suppers insert below.
            const isSupper = supper === true;

            // Coerce a possibly-malformed client nonce to a valid uuid. RN
            // runtimes lacking crypto.randomUUID sent `Date.now()-Math.random()`
            // → not a uuid → 22P02 on the entries.client_nonce cast → every log
            // 500'd. Deterministic so a retried stash still dedups.
            const safeClientNonce = await coerceClientNonce(client_nonce);

            // ── TICKET-043: normalize effective table_ids list ──────────────────
            // Normalize: prefer table_ids[], fall back to [table_id] if legacy.
            // Trim, dedupe preserving order, reject if > 10.
            const rawTableIds: string[] = Array.isArray(table_ids_raw)
                ? table_ids_raw
                : (table_id ? [table_id] : []);
            const effectiveTableIds: string[] = [...new Set(
                rawTableIds.map((id: string) => id?.trim()).filter(Boolean)
            )];

            if (effectiveTableIds.length > 10) {
                return new Response(
                    JSON.stringify({ error: { code: 'too_many_tables', message: 'Cannot post to more than 10 tables' } }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Membership validation for all table_ids.
            // TICKET-034 doctrine: use member_id (NOT user_id) when joining table_members.
            if (effectiveTableIds.length > 0) {
                const { data: memberships, error: membershipErr } = await supabase
                    .from('table_members')
                    .select('table_id')
                    .eq('member_id', user.id)
                    .in('table_id', effectiveTableIds);
                if (membershipErr) {
                    console.error('[entry] table membership check failed:', membershipErr);
                    throw membershipErr;
                }
                const allowed = new Set((memberships ?? []).map((m: { table_id: string }) => m.table_id));
                const offenders = effectiveTableIds.filter((id: string) => !allowed.has(id));
                if (offenders.length > 0) {
                    // Generic error code — do not distinguish 404 from 403 (no enumeration).
                    return new Response(
                        JSON.stringify({
                            error: {
                                code: 'table_not_authorized',
                                message: 'Some tables could not accept this post',
                                ids: offenders,
                            }
                        }),
                        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }
            }

            // Legacy resolvedTableId for code paths below that still use single table_id.
            const resolvedTableId: string | undefined = effectiveTableIds[0];

            // Validate secondary ratings if provided
            for (const [name, val] of Object.entries({ vibe_rating, flavor_rating, service_rating, value_rating })) {
                if (val !== null && val !== undefined) {
                    if (typeof val !== 'number' || val < 0.5 || val > 5.0) {
                        return new Response(
                            JSON.stringify({ error: `${name} must be between 0.5 and 5.0` }),
                            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        );
                    }
                }
            }

            let restaurantId: string | null = restaurant_id || null;
            let placeId: string | null = place_id || null;
            let userPlaceId: string | null = user_place_id || null;

            // Handle restaurant location
            if (restaurant?.external_id) {
                const isRestaurant = restaurant.types?.some((t: string) => FOOD_TYPES.includes(t)) ?? true;

                if (isRestaurant) {
                    restaurantId = await upsertRestaurant(supabase, {
                        external_id: restaurant.external_id,
                        name: restaurant.name,
                        location: {
                            address: restaurant.location?.address,
                            locality: restaurant.location?.locality,
                            country: restaurant.location?.country,
                        },
                        types: restaurant.types,
                        latitude: restaurant.latitude,
                        longitude: restaurant.longitude,
                        photoReference: restaurant.photoReference,
                        // TICKET-057: clients that pass photoReference must also pass
                        // photoAttributionHtml — empty/missing stamps photo_source='none'
                        // (sentinel) per AC 12 to honor the Places ToS attribution rule.
                        photoAttributionHtml: restaurant.photoAttributionHtml ?? null,
                        googleRating: restaurant.googleRating,
                        googleRatingCount: restaurant.googleRatingCount,
                        priceLevel: restaurant.priceLevel,
                        cuisine: restaurant.cuisine,
                        // TICKET-081: pass metadata through if the client carries it (additive).
                        phone: restaurant.phone,
                        website: restaurant.website,
                        googleMapsUri: restaurant.googleMapsUri ?? restaurant.google_maps_uri,
                        hours: restaurant.hours,
                    });
                } else {
                    // Upsert to places table (non-restaurant)
                    const { data: placeData, error: placeError } = await supabase
                        .from('places')
                        .upsert({
                            external_id: restaurant.external_id,
                            name: restaurant.name,
                            address: restaurant.location?.address,
                            types: restaurant.types || [],
                            lat: restaurant.latitude,
                            lng: restaurant.longitude,
                        }, { onConflict: 'external_id' })
                        .select('id')
                        .single();

                    if (placeError) throw placeError;
                    placeId = placeData.id;
                }
            }

            // Handle explicit place (non-restaurant Google Place)
            if (place?.external_id) {
                const { data: placeData, error: placeError } = await supabase
                    .from('places')
                    .upsert({
                        external_id: place.external_id,
                        name: place.name,
                        address: place.address,
                        types: place.types || [],
                        lat: place.latitude,
                        lng: place.longitude,
                    }, { onConflict: 'external_id' })
                    .select('id')
                    .single();

                if (placeError) throw placeError;
                placeId = placeData.id;
            }

            // ── TICKET-082: Supper pre-validation (BEFORE entry creation) ─────────
            // Codex Phase-2 review (HIGH): validate Supper inputs BEFORE the entry RPC
            // so a rejected Supper never leaves an orphan plain entry behind. The
            // validated participant set is reused by the supper-open block below.
            let validSupperParticipantIds: string[] = [];
            if (isSupper) {
                if (!restaurantId) {
                    return new Response(
                        JSON.stringify({ error: { code: 'supper_requires_restaurant', message: 'A Supper requires a restaurant' } }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }
                const rawSupperIds: string[] = Array.isArray(supper_participant_ids) ? supper_participant_ids : [];
                let sids = [...new Set(rawSupperIds.filter((id: string) => id && id !== user.id))];
                if (sids.length > 0) {
                    const { data: realProfiles, error: profilesErr } = await supabase
                        .from('profiles')
                        .select('user_id')
                        .in('user_id', sids);
                    if (profilesErr) throw profilesErr;
                    const realSet = new Set((realProfiles ?? []).map((p: { user_id: string }) => p.user_id));
                    sids = sids.filter((id) => realSet.has(id));
                }
                validSupperParticipantIds = sids;
            }

            // Prepare participant list before creating entry
            const ratingValue = (rating === 0 || rating === undefined || rating === null) ? null : rating;
            const visitedAtValue = visited_at ? new Date(visited_at).toISOString() : new Date().toISOString();
            const extraParticipantIds: string[] = Array.isArray(participant_ids) ? participant_ids : [];

            // TICKET-043: Strict participant-membership check across ALL table_ids.
            // Each participant must be a member of EVERY supplied table_id.
            // Uses member_id (NOT user_id) per TICKET-034 doctrine.
            if (effectiveTableIds.length > 0 && extraParticipantIds.length > 0) {
                const { data: memberRows } = await supabase
                    .from('table_members')
                    .select('member_id, table_id')
                    .in('table_id', effectiveTableIds)
                    .in('member_id', extraParticipantIds);

                // For each participant, check membership bucket size == effectiveTableIds.length
                const buckets = new Map<string, number>();
                for (const row of (memberRows ?? []) as { member_id: string; table_id: string }[]) {
                    buckets.set(row.member_id, (buckets.get(row.member_id) ?? 0) + 1);
                }
                const nonMembers = extraParticipantIds.filter(
                    (id: string) => (buckets.get(id) ?? 0) < effectiveTableIds.length
                );
                if (nonMembers.length > 0) {
                    return new Response(
                        JSON.stringify({ error: { code: 'participant_not_member', message: 'Some participants are not members of all selected tables', ids: nonMembers } }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }
            }

            // Derive hero photo URL: explicit photo_url takes priority, then first of photo_urls
            const photoUrlsArray: string[] = Array.isArray(photo_urls) ? photo_urls : [];
            const heroPhotoUrl = photo_url || photoUrlsArray[0] || null;

            // Always include the creator in participants; deduplicate in case creator is in participant_ids
            const allParticipantIds = [user.id, ...extraParticipantIds.filter((id: string) => id !== user.id)];

            // ── TICKET-043: Call fn_create_entry_with_tables (atomic RPC) ─────────
            // client_nonce dedup is handled inside the RPC; no pre-check needed here.
            // RPC returns { entry_id, was_dedup }.
            const entryPayload = {
                restaurant_id: restaurantId ?? null,
                place_id: placeId ?? null,
                user_place_id: userPlaceId ?? null,
                rating: ratingValue,
                content: content?.trim() || null,
                dish_description: dish_description?.trim() || null,
                cooked_by: cooked_by ?? null,
                value_profile: value_profile ?? null,
                visited_at: visitedAtValue,
                // Founder order 2026-07-22: an omitted visibility on CREATE means
                // the user made no privacy choice — default public-eligible
                // ('friends'), not 'private'. Explicit 'private' still wins; the
                // edit/merge and supper-take paths keep their own semantics.
                visibility: visibility ?? 'friends',
                ...(vibe_rating != null ? { vibe_rating } : {}),
                ...(flavor_rating != null ? { flavor_rating } : {}),
                ...(service_rating != null ? { service_rating } : {}),
                ...(value_rating != null ? { value_rating } : {}),
                // TICKET-075: always include `liked` (RPC COALESCEs to false anyway,
                // but sending it explicitly keeps the wire shape stable).
                liked: liked === true,
                ...(heroPhotoUrl ? { photo_url: heroPhotoUrl } : {}),
                ...(photoUrlsArray.length > 0 ? { photo_urls: photoUrlsArray } : {}),
                ...(safeClientNonce ? { client_nonce: safeClientNonce } : {}),
            };

            let entryId: string;
            let wasDedup: boolean = false;

            const { data: rpcResult, error: rpcError } = await supabase.rpc(
                'fn_create_entry_with_tables',
                {
                    p_user_id: user.id,
                    p_entry: entryPayload,
                    p_table_ids: effectiveTableIds.length > 0 ? effectiveTableIds : null,
                    p_participant_ids: allParticipantIds,
                    p_companion_ids: null, // companions handled non-fatally below
                }
            );

            if (rpcError) {
                console.error('[entry] fn_create_entry_with_tables error:', rpcError);
                // Map P0001 table_not_authorized to 403 with structured error.
                // The RPC raises with DETAIL = json_build_object('id', v_table_id);
                // surface that id in `ids` so the client can drop the stale selection
                // (matches the precheck shape — review-fix for Codex Review 2).
                if (rpcError.code === 'P0001' && rpcError.message?.includes('table_not_authorized')) {
                    let offenders: string[] = [];
                    try {
                        const detail = (rpcError as any).details ?? (rpcError as any).detail;
                        if (typeof detail === 'string') {
                            const parsed = JSON.parse(detail);
                            if (parsed?.id) offenders = [String(parsed.id)];
                        } else if (detail?.id) {
                            offenders = [String(detail.id)];
                        }
                    } catch (_) {
                        // best-effort — fall through to empty ids
                    }
                    return new Response(
                        JSON.stringify({
                            error: {
                                code: 'table_not_authorized',
                                message: 'Some tables could not accept this post',
                                ids: offenders,
                            }
                        }),
                        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }
                throw rpcError;
            }

            // RPC returns a table row (array with one element).
            const rpcRow = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
            entryId = rpcRow?.entry_id ?? rpcRow?.id;
            wasDedup = rpcRow?.was_dedup === true;

            if (!entryId) {
                throw new Error('fn_create_entry_with_tables returned no entry_id');
            }

            // On dedup: skip all fan-out (notifications, photo inserts, etc.)
            // and return the existing row shape.
            if (wasDedup) {
                const { data: existingEntry, error: fetchErr } = await supabase
                    .from('entries')
                    .select('*')
                    .eq('id', entryId)
                    .single();
                if (fetchErr) console.error('[entry] dedup fetch error (non-fatal):', fetchErr);
                const { count: dupCount } = await supabase
                    .from('entries')
                    .select('id', { count: 'exact', head: true })
                    .eq('user_id', user.id)
                    .lte('created_at', existingEntry?.created_at ?? new Date().toISOString());

                // TICKET-159 stitch (finding 14): the dedup path suggests too —
                // a retried create whose entry is still unattached deserves the
                // same "add this as your take?" moment. Same RPC as the fresh
                // path; suggest-only (the server never sets supper_id itself).
                const dedupRestaurantId = existingEntry?.restaurant_id ?? restaurantId ?? null;
                const dedupSupperSuggestion =
                    dedupRestaurantId && !existingEntry?.supper_id
                        ? await fetchSupperSuggestion(
                            supabase,
                            user.id,
                            dedupRestaurantId,
                            existingEntry?.visited_at ?? visitedAtValue,
                            entryId,
                        )
                        : null;

                return new Response(
                    JSON.stringify({
                        data: {
                            ...(existingEntry ?? { id: entryId }),
                            table_id: effectiveTableIds[0] ?? null,
                            table_ids: effectiveTableIds,
                            // Nested INSIDE data — callEdgeFn strips the envelope.
                            supper_suggestion: dedupSupperSuggestion,
                        },
                        entry_ordinal: dupCount ?? null,
                        warnings: [{ type: 'duplicate_submission' }],
                    }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Fetch the newly created entry row (service-role can read table_id).
            const { data: entryData, error: entryFetchError } = await supabase
                .from('entries')
                .select('*')
                .eq('id', entryId)
                .single();

            if (entryFetchError) {
                console.error('Entry fetch after RPC error:', entryFetchError);
                throw entryFetchError;
            }

            // ── TICKET-082: open a Supper on this host entry ──────────────────
            // A Supper is a shared `entries` cluster keyed by `supper_id`. The host's
            // entry (just created above) becomes the first take. We:
            //   1. validate the host entry has a restaurant (suppers.restaurant_id NOT NULL),
            //   2. validate each supper_participant_id is a real user (drop unknowns),
            //   3. insert the suppers anchor row,
            //   4. set entries.supper_id on the host entry (service-role UPDATE — the
            //      fn_create_entry_with_tables RPC does not carry supper_id, so we patch
            //      it here rather than touching the shared RPC / requiring a migration),
            //   5. seed supper_members (host + each tagged friend) — service-role-write-only,
            //   6. write entry_companions (host entry, each participant) so the existing
            //      "with X · Y" line renders everywhere companions already render.
            // supper_members is the trust anchor; entries.supper_id is the group key but
            // is NOT trusted for membership (it stays client-writable).
            let createdSupperId: string | null = null;
            let supperOpenFailed = false;
            if (isSupper && restaurantId) {
                // Atomic-ish Supper open with COMPENSATING CLEANUP (Codex Phase-2 review,
                // MEDIUM): inputs were validated before the entry RPC; here, if any write
                // fails partway, we roll the Supper back so no partial state survives — the
                // host's entry is preserved as a plain log + a `supper_open_failed` warning.
                try {
                    // 1. Insert the suppers anchor.
                    const { data: supperRow, error: supperErr } = await supabase
                        .from('suppers')
                        .insert({ restaurant_id: restaurantId, host_user_id: user.id })
                        .select('id')
                        .single();
                    if (supperErr) throw supperErr;
                    createdSupperId = supperRow.id;

                    // 2. Bind the host entry to the supper (group key).
                    const { error: bindErr } = await supabase
                        .from('entries')
                        .update({ supper_id: createdSupperId })
                        .eq('id', entryData.id);
                    if (bindErr) throw bindErr;

                    // 3. Seed supper_members: host + each validated tagged friend.
                    const memberRows = [user.id, ...validSupperParticipantIds].map((uid) => ({
                        supper_id: createdSupperId,
                        user_id: uid,
                    }));
                    const { error: membersErr } = await supabase
                        .from('supper_members')
                        .insert(memberRows);
                    if (membersErr) throw membersErr;

                    // Reflect the binding in the in-memory row so the response carries it.
                    (entryData as { supper_id?: string | null }).supper_id = createdSupperId;

                    // 4. Write entry_companions on the host entry so the "with X · Y" line
                    //    renders. Union of validated participants + any client companion_ids.
                    const clientCompanionIds: string[] = Array.isArray(companion_ids) ? companion_ids : [];
                    const supperCompanionIds = [...new Set(
                        [...validSupperParticipantIds, ...clientCompanionIds].filter((id: string) => id && id !== user.id)
                    )];
                    if (supperCompanionIds.length > 0) {
                        const { error: supperCompErr } = await supabase
                            .from('entry_companions')
                            .insert(supperCompanionIds.map((uid: string) => ({ entry_id: entryData.id, user_id: uid })));
                        // Non-fatal: a companion-write failure must not orphan the supper.
                        if (supperCompErr) {
                            console.error('[entry] supper entry_companions insert error (non-fatal):', supperCompErr);
                        }
                    }
                } catch (supperOpenErr) {
                    // Compensating cleanup: roll back partial Supper state. Deleting the
                    // suppers row cascades supper_members; we also unset the entry's
                    // supper_id. The host's entry survives as a plain successful log.
                    console.error('[entry] supper open failed, rolling back:', supperOpenErr);
                    supperOpenFailed = true;
                    if (createdSupperId) {
                        await supabase.from('entries').update({ supper_id: null }).eq('id', entryData.id);
                        await supabase.from('suppers').delete().eq('id', createdSupperId);
                    }
                    (entryData as { supper_id?: string | null }).supper_id = null;
                    createdSupperId = null;
                }
            }

            // Photo rows, hero binding, and image refs committed inside the
            // entry RPC.  Keeping this outside the RPC would let the flag flip
            // between the entry write and the ref bind.

            // If it's a restaurant entry, update user_restaurant_status
            if (restaurantId) {
                const { error: statusError } = await supabase
                    .from('user_restaurant_status')
                    .upsert({
                        user_id: user.id,
                        restaurant_id: restaurantId,
                        been: true,
                        want_to_try: false,
                        updated_at: new Date().toISOString(),
                    }, { onConflict: 'user_id,restaurant_id' });

                if (statusError) {
                    console.error('Status upsert error (non-fatal):', statusError);
                }
            }

            // entry_participants were inserted atomically in fn_create_entry_with_tables RPC.

            // ── Insert entry_companions (non-fatal, outside atomic RPC — finding 16) ──
            // companion_ids: arbitrary Napkin users; no Table-membership gate (Instagram-style)
            // TICKET-037 (P1-11): explicitly exclude allParticipantIds so a user can't appear
            // in both the "6 ratings" strip and the "with X" companions list.
            // TICKET-082: for a Supper the companion rows were already written above
            // (union of supper_participant_ids + companion_ids). Skip here so we don't
            // attempt a duplicate (entry_id,user_id) insert that the PK would reject.
            const rawCompanionIds: string[] = isSupper
                ? []
                : (Array.isArray(companion_ids) ? companion_ids : []);
            const sanitizedCompanionIds = [...new Set(
                rawCompanionIds.filter((id: string) => id && id !== user.id && !allParticipantIds.includes(id))
            )];

            if (sanitizedCompanionIds.length !== rawCompanionIds.length) {
                console.warn(
                    'entry: dropped',
                    rawCompanionIds.length - sanitizedCompanionIds.length,
                    'duplicate companion ids (overlapped with self or participant_ids)'
                );
            }

            const warnings: Array<{ type: string; failed_ids?: string[]; reason?: string }> = [];

            // TICKET-082: if the Supper failed to open (rolled back above), the entry
            // still succeeded as a plain log — tell the client so it can message it.
            if (supperOpenFailed) {
                warnings.push({ type: 'supper_open_failed' });
            }

            if (sanitizedCompanionIds.length > 0) {
                const companionRows = sanitizedCompanionIds.map((uid: string) => ({
                    entry_id: entryData.id,
                    user_id: uid,
                }));
                const { error: compInsertError } = await supabase
                    .from('entry_companions')
                    .insert(companionRows);
                if (compInsertError) {
                    // Non-fatal: log and surface as a warning in the response (TICKET-037 P2-13)
                    console.error('entry_companions insert error (non-fatal):', compInsertError);
                    warnings.push({
                        type: 'companion_tag_failed',
                        failed_ids: sanitizedCompanionIds,
                        reason: compInsertError.message,
                    });
                }
            }

            console.log('Entry created:', entryData.id);

            // ── Notifications fan-out (best-effort, TICKET-048) ─────────────────
            // Only fire if the entry has a restaurant (friend_logged CHECK requires subject_restaurant_id).
            // Fix #7 (Codex review 2026-04-28): log query errors — supabase-js never
            // throws on query failure; always check { error } or the recipient set
            // silently comes back empty.
            if (restaurantId) {
                try {
                    const recipientSet = new Set<string>();

                    // (a) Table-shared entry → union of members across ALL table_ids (TICKET-043).
                    // One notification per recipient regardless of how many of their Tables overlap.
                    // IMPORTANT: never reference table ids/names in notification payload.
                    if (effectiveTableIds.length > 0) {
                        const { data: members, error: membersErr } = await supabase
                            .from('table_members')
                            .select('member_id')
                            .in('table_id', effectiveTableIds);
                        if (membersErr) {
                            console.error('[notify] emitFriendLogged: table_members query failed', membersErr);
                        }
                        for (const m of (members ?? []) as { member_id: string }[]) {
                            recipientSet.add(m.member_id);
                        }
                    }

                    // (b) Companion-tagged → each CONFIRMED-inserted companion.
                    //     Re-SELECT post-insert to reflect only rows that actually landed.
                    //     (entry_companions uses column `user_id`, not `companion_user_id`.)
                    if (sanitizedCompanionIds.length > 0) {
                        const { data: confirmedCompanions, error: companionsErr } = await supabase
                            .from('entry_companions')
                            .select('user_id')
                            .eq('entry_id', entryData.id);
                        if (companionsErr) {
                            console.error('[notify] emitFriendLogged: entry_companions query failed', companionsErr);
                        }
                        for (const c of confirmedCompanions ?? []) recipientSet.add(c.user_id);
                    }

                    // (c) Public-eligible solo (no table_ids AND no companions) → followers.
                    //     Only this branch is gated on the public-eligibility predicate;
                    //     (a) and (b) carry their own visibility (membership / explicit tag).
                    if (effectiveTableIds.length === 0 && sanitizedCompanionIds.length === 0) {
                        const { data: eligible, error: eligibleErr } = await supabase
                            .rpc('is_entry_publicly_eligible', { p_entry_id: entryData.id });
                        if (eligibleErr) {
                            console.error('[notify] emitFriendLogged: is_entry_publicly_eligible rpc failed', eligibleErr);
                        }
                        if (eligible === true) {
                            const { data: followers, error: followersErr } = await supabase
                                .from('follows')
                                .select('follower_id')
                                .eq('following_id', user.id);
                            if (followersErr) {
                                console.error('[notify] emitFriendLogged: follows query failed', followersErr);
                            }
                            for (const f of followers ?? []) recipientSet.add(f.follower_id);
                        }
                    }

                    // Always exclude the actor.
                    recipientSet.delete(user.id);

                    await emitFriendLogged(supabase, {
                        actorUserId: user.id,
                        recipientUserIds: Array.from(recipientSet),
                        entryId: entryData.id,
                        restaurantId,
                        // NOTE: no table_id/table_ids in the notification payload (privacy invariant).
                    });
                } catch (notifyErr) {
                    // Best-effort: never fail the entry create because of inbox issues.
                    console.error('[notify] friend_logged fan-out threw:', notifyErr);
                }
            }

            // ── entry_ordinal: per-user lifetime entry count (TICKET-050) ──────
            // Computed with a count(*) AFTER the insert so the new row is included.
            // KNOWN LIMITATION (v1): two concurrent inserts by the same user can
            // race and both read the same ordinal. Acceptable — ordinal is decorative,
            // not a stable identity, and the composer is single-threaded.
            // UPGRADE PATH: replace with a per-user bigint counter maintained by a
            // trigger or a per-user sequence (schema-only change, no client delta).
            const { count: entryCount, error: countErr } = await supabase
                .from('entries')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', user.id);
            if (countErr) {
                console.error('entry_ordinal count failed for user', user.id, countErr);
            }
            const entry_ordinal = countErr ? null : (entryCount ?? null);

            // ── TICKET-159 stray-log stitch (suggest-only) ──────────────────────
            // A fresh restaurant log that ISN'T already supper-bound (no supper
            // opened here, no take path) gets at most ONE supper_suggestion when a
            // supper the author belongs to matches restaurant + night (±1 day HKT).
            // The client shows a confirm sheet; the server NEVER attaches on its own.
            const supperSuggestion =
                restaurantId && !createdSupperId
                    ? await fetchSupperSuggestion(supabase, user.id, restaurantId, visitedAtValue, entryData.id)
                    : null;

            return new Response(
                JSON.stringify({
                    // TICKET-043: author-facing response includes table_ids[].
                    // Member-facing reads (table-activity, entry detail by non-author)
                    // MUST omit table_ids[] and rewrite table_id to the requesting Table's id.
                    data: {
                        ...entryData,
                        table_id: effectiveTableIds[0] ?? null,  // primary (legacy mirror)
                        table_ids: effectiveTableIds,            // author-facing only
                        // TICKET-082: nest supper_id INSIDE data (callEdgeFn strips the
                        // outer envelope, so a sibling field would be dropped).
                        supper_id: createdSupperId,
                        // TICKET-159: same nesting rule as supper_id/merge_outcome.
                        supper_suggestion: supperSuggestion,
                    },
                    entry_ordinal,
                    ...(warnings.length > 0 ? { warnings } : {}),
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('entry function error:', error);
        reportError(error, { fn: 'entry' });
        // Serialize real error info — String(PostgrestError) is "[object Object]",
        // which made the 2026-06-11 RPC-ambiguity outage undiagnosable from the client.
        const detail = (error as any)?.message
            ?? (typeof error === 'object' ? JSON.stringify(error) : String(error));
        const code = (error as any)?.code;
        return new Response(
            JSON.stringify({ error: 'Internal Server Error', details: detail, ...(code ? { code } : {}) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
