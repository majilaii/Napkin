/**
 * Table Night / Round Edge Function
 * Manages group rating sessions (both live and async Rounds).
 *
 * POST actions: start, join, rate, ready, reveal, nudge_reveal
 * GET actions: status, active, round_context
 *
 * TICKET-037: rate and start now delegate multi-step writes to RPCs
 * (rate_round, start_round) so they are atomic. nudge_reveal wraps
 * maybe_reveal_round. round_context replaces the direct DB fetch in
 * useRoundContext (validates membership server-side).
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { reportError } from '../_shared/report.ts';
import { upsertRestaurant } from '../_shared/restaurant.ts';
import { errorResponse, mapPgError } from '../_shared/errors.ts';

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!authHeader) {
            return errorResponse('UNAUTHORIZED', 'Missing Authorization header', 401);
        }

        const token = authHeader.replace('Bearer ', '');
        const supabase = createClient(supabaseUrl ?? '', supabaseServiceKey ?? '');

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return errorResponse('UNAUTHORIZED', 'Unauthorized', 401);
        }

        const json = (data: unknown, status = 200) =>
            new Response(JSON.stringify({ data }), {
                status,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });

        const fail = (message: string, status = 400, code = 'INVALID_INPUT') =>
            errorResponse(code, message, status);

        // Helper: check if user is a member of a table.
        // maybeSingle → null on no rows; any real DB error throws to the outer
        // catch (500) so a transient failure never reads as "not a member."
        async function validateTableMember(tableId: string) {
            const { data, error } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', tableId)
                .eq('member_id', user!.id)
                .maybeSingle();
            if (error) throw new Error(`validateTableMember failed: ${error.message}`);
            return !!data;
        }

        // Helper: validate a rating value (0.5–5.0)
        function isValidRating(val: unknown): val is number {
            return typeof val === 'number' && val >= 0.5 && val <= 5.0;
        }

        // GET requests
        if (req.method === 'GET') {
            const url = new URL(req.url);
            const action = url.searchParams.get('action');

            if (action === 'status') {
                const tableNightId = url.searchParams.get('table_night_id');
                if (!tableNightId) return fail('table_night_id is required');

                // TICKET-044: kind='live' guard — merged rounds must not surface in live UI.
                const { data: night, error: nightError } = await supabase
                    .from('table_nights')
                    .select('*')
                    .eq('id', tableNightId)
                    .eq('kind', 'live')
                    .single();

                if (nightError) throw nightError;

                // Fetch restaurant details
                let restaurant = null;
                if (night.restaurant_id) {
                    const { data: r, error: rErr } = await supabase
                        .from('restaurants')
                        .select('id, name, address, city, photo_url')
                        .eq('id', night.restaurant_id)
                        .single();
                    if (rErr) {
                        console.error('restaurant fetch error (non-fatal):', rErr.message);
                    } else {
                        restaurant = r;
                    }
                }

                const { data: participants, error: partError } = await supabase
                    .from('table_night_participants')
                    .select(`
                        user_id,
                        rating,
                        vibe_rating,
                        flavor_rating,
                        service_rating,
                        value_rating,
                        ready,
                        notes,
                        profiles (
                            display_name,
                            avatar_url
                        )
                    `)
                    .eq('table_night_id', tableNightId);

                if (partError) throw partError;

                // Join entries to get dish_description per participant
                const { data: entries, error: entriesErr } = await supabase
                    .from('entries')
                    .select('user_id, dish_description')
                    .eq('table_night_id', tableNightId);

                if (entriesErr) {
                    console.error('entries fetch error (non-fatal):', entriesErr.message);
                }

                const dishByUser: Record<string, string | null> = {};
                if (entries) {
                    for (const e of entries) {
                        dishByUser[e.user_id] = e.dish_description ?? null;
                    }
                }

                // Hide ratings if not yet revealed
                const safeParticipants = night.status === 'revealed'
                    ? participants?.map((p: any) => ({
                        ...p,
                        dish_description: dishByUser[p.user_id] ?? null,
                    }))
                    : participants?.map((p: any) => ({
                        ...p,
                        rating: null,
                        vibe_rating: null,
                        flavor_rating: null,
                        service_rating: null,
                        value_rating: null,
                        dish_description: dishByUser[p.user_id] ?? null,
                    }));

                return json({ ...night, restaurants: restaurant, participants: safeParticipants });
            }

            if (action === 'active') {
                const tableId = url.searchParams.get('table_id');
                if (!tableId) return fail('table_id is required');

                // TICKET-044: kind='live' guard — merged rounds have status=NULL and must never
                // surface as an "active" round in the live-round banner.
                const { data: night, error: activeErr } = await supabase
                    .from('table_nights')
                    .select('*')
                    .eq('table_id', tableId)
                    .eq('kind', 'live')
                    .eq('status', 'rating')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (activeErr) {
                    console.error('active fetch error:', activeErr.message);
                    throw activeErr;
                }

                return json(night);
            }

            // ── round_context ─────────────────────────────────────────────
            // Validates membership, returns { nightId, participantCount, status, groupAverage }.
            // Replaces the direct DB fetch in useRoundContext (TICKET-037 / P1-13).
            if (action === 'round_context') {
                const tableNightId = url.searchParams.get('table_night_id');
                if (!tableNightId) return fail('table_night_id is required');

                // Validate user is a member of the round's table.
                // TICKET-044: kind='live' guard — merged rounds must not appear in live round_context.
                const { data: night, error: nightErr } = await supabase
                    .from('table_nights')
                    .select('id, table_id, status')
                    .eq('id', tableNightId)
                    .eq('kind', 'live')
                    .single();

                if (nightErr || !night) return fail('Round not found', 404, 'NOT_FOUND');

                const isMember = await validateTableMember(night.table_id);
                if (!isMember) return fail('Not a member of this table', 403, 'FORBIDDEN');

                const { data: participants, error: partErr } = await supabase
                    .from('table_night_participants')
                    .select('rating')
                    .eq('table_night_id', tableNightId);

                if (partErr) throw partErr;

                const participantCount = (participants ?? []).length;

                let groupAverage: number | null = null;
                if (night.status === 'revealed') {
                    const rated = (participants ?? [])
                        .filter((p: any) => p.rating != null)
                        .map((p: any) => p.rating as number);
                    if (rated.length > 0) {
                        groupAverage = rated.reduce((a: number, b: number) => a + b, 0) / rated.length;
                    }
                }

                return json({
                    nightId: tableNightId,
                    participantCount,
                    status: night.status,
                    groupAverage,
                });
            }

            return fail('Invalid action. Use ?action=status, ?action=active, or ?action=round_context');
        }

        // POST requests
        if (req.method === 'POST') {
            const body = await req.json();
            const { action } = body;

            // ── START (creates a Round) ───────────────────────────────────
            if (action === 'start') {
                const {
                    table_id,
                    restaurant_id: existingRestaurantId,
                    restaurant,
                    participant_ids,
                    is_async,
                    rating,
                    notes,
                    dish_description,
                    photo_url,
                    photo_urls,
                    vibe_rating,
                    flavor_rating,
                    service_rating,
                    value_rating,
                    client_nonce,
                } = body;

                if (!table_id) return fail('table_id is required');

                if (!(await validateTableMember(table_id))) {
                    return fail('You are not a member of this table', 403, 'FORBIDDEN');
                }

                // Resolve restaurant ID: either passed directly or upsert from restaurant data
                let restaurantId = existingRestaurantId;
                if (!restaurantId && restaurant?.external_id) {
                    restaurantId = await upsertRestaurant(supabase, restaurant);
                }
                if (!restaurantId) return fail('restaurant_id or restaurant data is required');

                // Validate host rating
                if (!isValidRating(rating)) {
                    return fail('rating is required (0.5–5.0)');
                }

                const startPhotoUrlsArray: string[] = Array.isArray(photo_urls) ? photo_urls : [];
                // Merge single photo_url into array (legacy compat)
                if (photo_url && !startPhotoUrlsArray.includes(photo_url)) {
                    startPhotoUrlsArray.unshift(photo_url);
                }

                const attendeeIds: string[] = Array.isArray(participant_ids)
                    ? participant_ids.filter((id: string) => id !== user.id)
                    : [];

                let rpcResult: { night_id: string; entry_id: string };
                try {
                    const { data: rpcData, error: rpcErr } = await supabase.rpc('start_round', {
                        p_table_id:        table_id,
                        p_restaurant_id:   restaurantId,
                        p_host_user_id:    user.id,
                        p_host_rating:     rating,
                        p_host_notes:      notes ?? null,
                        p_host_dish:       dish_description ?? null,
                        p_photo_urls:      startPhotoUrlsArray.length > 0 ? startPhotoUrlsArray : null,
                        p_attendee_ids:    attendeeIds.length > 0 ? attendeeIds : null,
                        p_is_async:        is_async !== false,
                        p_vibe_rating:     isValidRating(vibe_rating) ? vibe_rating : null,
                        p_flavor_rating:   isValidRating(flavor_rating) ? flavor_rating : null,
                        p_service_rating:  isValidRating(service_rating) ? service_rating : null,
                        p_value_rating:    isValidRating(value_rating) ? value_rating : null,
                        p_client_nonce:    client_nonce ?? null,
                    });
                    if (rpcErr) throw rpcErr;
                    rpcResult = rpcData as { night_id: string; entry_id: string };
                } catch (err: any) {
                    const { code, status } = mapPgError(err);
                    return errorResponse(code, err.message ?? 'start_round failed', status);
                }

                // Fetch the full night row so callers get status/revealed_at
                const { data: night, error: nightFetchErr } = await supabase
                    .from('table_nights')
                    .select('*')
                    .eq('id', rpcResult.night_id)
                    .single();

                if (nightFetchErr) throw nightFetchErr;

                return json(night, 201);
            }

            // ── JOIN ──────────────────────────────────────────────────────
            if (action === 'join') {
                const { table_night_id } = body;
                if (!table_night_id) return fail('table_night_id is required');

                // TICKET-044: kind='live' guard — merged rounds have no join flow.
                const { data: night, error: nightError } = await supabase
                    .from('table_nights')
                    .select('table_id, status')
                    .eq('id', table_night_id)
                    .eq('kind', 'live')
                    .single();

                if (nightError) throw nightError;
                if (night.status !== 'rating') return fail('This Round is not in the rating phase');
                if (!(await validateTableMember(night.table_id))) {
                    return fail('You are not a member of this table', 403, 'FORBIDDEN');
                }

                const { data: participant, error: partError } = await supabase
                    .from('table_night_participants')
                    .upsert(
                        { table_night_id, user_id: user.id },
                        { onConflict: 'table_night_id,user_id' }
                    )
                    .select()
                    .single();

                if (partError) throw partError;

                return json(participant, 201);
            }

            // ── RATE (submit full impression + auto-reveal) ───────────────
            if (action === 'rate') {
                const {
                    table_night_id,
                    rating,
                    notes,
                    dish_description,
                    photo_url,
                    photo_urls,
                    vibe_rating,
                    flavor_rating,
                    service_rating,
                    value_rating,
                    client_nonce,
                } = body;

                if (!table_night_id) return fail('table_night_id is required');

                if (!isValidRating(rating)) {
                    return fail('Rating must be 0.5 to 5.0');
                }

                const ratePhotoUrlsArray: string[] = Array.isArray(photo_urls) ? photo_urls : [];
                // Merge single photo_url into array (legacy compat)
                if (photo_url && !ratePhotoUrlsArray.includes(photo_url)) {
                    ratePhotoUrlsArray.unshift(photo_url);
                }

                let rpcResult: { entry_id: string; round_status: string; revealed: boolean };
                try {
                    const { data: rpcData, error: rpcErr } = await supabase.rpc('rate_round', {
                        p_round_id:       table_night_id,
                        p_user_id:        user.id,
                        p_rating:         rating,
                        p_notes:          notes ?? null,
                        p_dish:           dish_description ?? null,
                        p_photo_urls:     ratePhotoUrlsArray.length > 0 ? ratePhotoUrlsArray : null,
                        p_vibe_rating:    isValidRating(vibe_rating) ? vibe_rating : null,
                        p_flavor_rating:  isValidRating(flavor_rating) ? flavor_rating : null,
                        p_service_rating: isValidRating(service_rating) ? service_rating : null,
                        p_value_rating:   isValidRating(value_rating) ? value_rating : null,
                        p_client_nonce:   client_nonce ?? null,
                    });
                    if (rpcErr) throw rpcErr;
                    rpcResult = rpcData as { entry_id: string; round_status: string; revealed: boolean };
                } catch (err: any) {
                    const { code, status } = mapPgError(err);
                    return errorResponse(code, err.message ?? 'rate_round failed', status);
                }

                return json({
                    entry_id:     rpcResult.entry_id,
                    round_status: rpcResult.round_status,
                    revealed:     rpcResult.revealed,
                });
            }

            // ── NUDGE_REVEAL ──────────────────────────────────────────────
            // Safety valve: call maybe_reveal_round for a stuck round.
            if (action === 'nudge_reveal') {
                const { round_id } = body;
                if (!round_id) return fail('round_id is required');

                let rpcResult: { status: string };
                try {
                    const { data: rpcData, error: rpcErr } = await supabase.rpc('maybe_reveal_round', {
                        p_round_id: round_id,
                        p_user_id:  user.id,
                    });
                    if (rpcErr) throw rpcErr;
                    rpcResult = rpcData as { status: string };
                } catch (err: any) {
                    const { code, status } = mapPgError(err);
                    return errorResponse(code, err.message ?? 'maybe_reveal_round failed', status);
                }

                return json({ status: rpcResult.status });
            }

            // ── READY ─────────────────────────────────────────────────────
            if (action === 'ready') {
                const { table_night_id } = body;
                if (!table_night_id) return fail('table_night_id is required');

                // TICKET-044: belt-and-suspenders kind='live' guard.
                // Merged rounds have no table_night_participants rows so this path
                // would fail naturally, but we check explicitly per the exhaustive
                // coverage requirement.
                const { data: roundKindCheck } = await supabase
                    .from('table_nights')
                    .select('kind')
                    .eq('id', table_night_id)
                    .eq('kind', 'live')
                    .maybeSingle();
                if (!roundKindCheck) return fail('Round not found or not a live round', 404, 'NOT_FOUND');

                const { data: participant, error: partError } = await supabase
                    .from('table_night_participants')
                    .select('rating')
                    .eq('table_night_id', table_night_id)
                    .eq('user_id', user.id)
                    .single();

                if (partError) return fail('You are not a participant in this Round');
                if (participant.rating === null) return fail('You must submit a rating before locking in');

                const { data: updated, error: updateError } = await supabase
                    .from('table_night_participants')
                    .update({ ready: true })
                    .eq('table_night_id', table_night_id)
                    .eq('user_id', user.id)
                    .select()
                    .single();

                if (updateError) throw updateError;

                return json(updated);
            }

            // ── REVEAL ────────────────────────────────────────────────────
            if (action === 'reveal') {
                const { table_night_id } = body;
                if (!table_night_id) return fail('table_night_id is required');

                // TICKET-044: kind='live' guard — merged rounds have no reveal flow.
                const { data: night, error: nightError } = await supabase
                    .from('table_nights')
                    .select('host_user_id, status')
                    .eq('id', table_night_id)
                    .eq('kind', 'live')
                    .single();

                if (nightError) throw nightError;
                if (night.host_user_id !== user.id) return fail('Only the host can trigger reveal', 403, 'FORBIDDEN');
                if (night.status !== 'rating') return fail('This Round is not in the rating phase');

                const { data: participants, error: partError } = await supabase
                    .from('table_night_participants')
                    .select('user_id, rating, ready')
                    .eq('table_night_id', table_night_id);

                if (partError) throw partError;
                if (!participants || participants.length < 2) return fail('Need at least 2 participants to reveal');
                if (participants.some((p: any) => !p.ready)) return fail('All participants must be ready before reveal');

                const { data: revealed, error: revealError } = await supabase
                    .from('table_nights')
                    .update({ status: 'revealed', revealed_at: new Date().toISOString() })
                    .eq('id', table_night_id)
                    .select()
                    .single();

                if (revealError) throw revealError;

                const { data: fullParticipants, error: fullPartError } = await supabase
                    .from('table_night_participants')
                    .select(`
                        user_id,
                        rating,
                        vibe_rating,
                        flavor_rating,
                        service_rating,
                        value_rating,
                        ready,
                        notes,
                        profiles (
                            display_name,
                            avatar_url
                        )
                    `)
                    .eq('table_night_id', table_night_id);

                if (fullPartError) throw fullPartError;

                // Join entries to get dish_description per participant
                const { data: revealEntries, error: revealEntriesErr } = await supabase
                    .from('entries')
                    .select('user_id, dish_description')
                    .eq('table_night_id', table_night_id);

                if (revealEntriesErr) {
                    console.error('reveal entries fetch error (non-fatal):', revealEntriesErr.message);
                }

                const revealDishByUser: Record<string, string | null> = {};
                if (revealEntries) {
                    for (const e of revealEntries) {
                        revealDishByUser[e.user_id] = e.dish_description ?? null;
                    }
                }

                const revealParticipants = (fullParticipants ?? []).map((p: any) => ({
                    ...p,
                    dish_description: revealDishByUser[p.user_id] ?? null,
                }));

                // Join restaurant
                let revealRestaurant = null;
                if (revealed.restaurant_id) {
                    const { data: r, error: rErr } = await supabase
                        .from('restaurants')
                        .select('id, name, address, city, photo_url')
                        .eq('id', revealed.restaurant_id)
                        .single();
                    if (rErr) {
                        console.error('reveal restaurant fetch error (non-fatal):', rErr.message);
                    } else {
                        revealRestaurant = r;
                    }
                }

                return json({ ...revealed, restaurants: revealRestaurant, participants: revealParticipants });
            }

            return fail('Invalid action. Use: start, join, rate, ready, reveal, nudge_reveal');
        }

        return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed', 405);

    } catch (error) {
        console.error('table-night error:', error);
        reportError(error, { fn: 'table-night' });
        const message = error instanceof Error ? error.message : JSON.stringify(error);
        return new Response(
            JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error', details: message } }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
