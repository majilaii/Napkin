/**
 * Table Night / Round Edge Function
 * Manages group rating sessions (both live and async Rounds).
 *
 * POST actions: start, join, rate, ready, reveal
 * GET actions: status, active
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { upsertRestaurant } from '../_shared/restaurant.ts';

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
        const supabase = createClient(supabaseUrl ?? '', supabaseServiceKey ?? '');

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const json = (data: unknown, status = 200) =>
            new Response(JSON.stringify({ data }), {
                status,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });

        const fail = (error: string, status = 400) =>
            new Response(JSON.stringify({ error }), {
                status,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });

        // Helper: check if user is a member of a table
        async function validateTableMember(tableId: string) {
            const { data } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', tableId)
                .eq('member_id', user!.id)
                .single();
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

                const { data: night, error: nightError } = await supabase
                    .from('table_nights')
                    .select('*')
                    .eq('id', tableNightId)
                    .single();

                if (nightError) throw nightError;

                // Fetch restaurant details
                let restaurant = null;
                if (night.restaurant_id) {
                    const { data: r } = await supabase
                        .from('restaurants')
                        .select('id, name, address, city, photo_url')
                        .eq('id', night.restaurant_id)
                        .single();
                    restaurant = r;
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
                            display_name
                        )
                    `)
                    .eq('table_night_id', tableNightId);

                if (partError) throw partError;

                // Join entries to get dish_description per participant
                const { data: entries } = await supabase
                    .from('entries')
                    .select('user_id, dish_description')
                    .eq('table_night_id', tableNightId);

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

                const { data: night } = await supabase
                    .from('table_nights')
                    .select('*')
                    .eq('table_id', tableId)
                    .eq('status', 'rating')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                return json(night);
            }

            return fail('Invalid action. Use ?action=status or ?action=active');
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
                    vibe_rating,
                    flavor_rating,
                    service_rating,
                    value_rating,
                } = body;

                if (!table_id) return fail('table_id is required');

                if (!(await validateTableMember(table_id))) {
                    return fail('You are not a member of this table', 403);
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

                // Create the Round (table_nights row)
                const { data: night, error: nightError } = await supabase
                    .from('table_nights')
                    .insert({
                        table_id,
                        restaurant_id: restaurantId,
                        host_user_id: user.id,
                        status: 'rating',
                        is_async: is_async !== false, // default true
                    })
                    .select()
                    .single();

                if (nightError) throw nightError;

                // Create host's participant row (with ratings filled)
                const { error: hostPartError } = await supabase
                    .from('table_night_participants')
                    .insert({
                        table_night_id: night.id,
                        user_id: user.id,
                        rating,
                        ready: true,
                        notes: notes?.trim() || null,
                        ...(isValidRating(vibe_rating) ? { vibe_rating } : {}),
                        ...(isValidRating(flavor_rating) ? { flavor_rating } : {}),
                        ...(isValidRating(service_rating) ? { service_rating } : {}),
                        ...(isValidRating(value_rating) ? { value_rating } : {}),
                    });

                if (hostPartError) throw hostPartError;

                // Create host's journal entry
                const { error: entryError } = await supabase
                    .from('entries')
                    .insert({
                        user_id: user.id,
                        restaurant_id: restaurantId,
                        table_id,
                        table_night_id: night.id,
                        rating,
                        content: notes?.trim() || null,
                        dish_description: dish_description?.trim() || null,
                        visibility: 'table',
                        ...(photo_url ? { photo_url } : {}),
                        ...(isValidRating(vibe_rating) ? { vibe_rating } : {}),
                        ...(isValidRating(flavor_rating) ? { flavor_rating } : {}),
                        ...(isValidRating(service_rating) ? { service_rating } : {}),
                        ...(isValidRating(value_rating) ? { value_rating } : {}),
                    });

                if (entryError) throw entryError;

                // Create empty participant rows for attendees
                const attendeeIds: string[] = Array.isArray(participant_ids)
                    ? participant_ids.filter((id: string) => id !== user.id)
                    : [];

                if (attendeeIds.length > 0) {
                    // Validate all attendees are table members
                    const { data: members } = await supabase
                        .from('table_members')
                        .select('member_id')
                        .eq('table_id', table_id)
                        .in('member_id', attendeeIds);

                    const memberSet = new Set((members ?? []).map((m: any) => m.member_id));
                    const nonMembers = attendeeIds.filter((id: string) => !memberSet.has(id));
                    if (nonMembers.length > 0) {
                        return fail(`Some participants are not members of this table`);
                    }

                    const attendeeRows = attendeeIds.map((id: string) => ({
                        table_night_id: night.id,
                        user_id: id,
                    }));

                    const { error: attendeeError } = await supabase
                        .from('table_night_participants')
                        .insert(attendeeRows);

                    if (attendeeError) throw attendeeError;
                }

                // Check if auto-complete (host is only participant = all ready)
                // Only when no attendees were added
                if (attendeeIds.length === 0) {
                    await supabase
                        .from('table_nights')
                        .update({ status: 'revealed', revealed_at: new Date().toISOString() })
                        .eq('id', night.id)
                        .eq('status', 'rating');
                }

                return json(night, 201);
            }

            // ── JOIN ──────────────────────────────────────────────────────
            if (action === 'join') {
                const { table_night_id } = body;
                if (!table_night_id) return fail('table_night_id is required');

                const { data: night, error: nightError } = await supabase
                    .from('table_nights')
                    .select('table_id, status')
                    .eq('id', table_night_id)
                    .single();

                if (nightError) throw nightError;
                if (night.status !== 'rating') return fail('This Round is not in the rating phase');
                if (!(await validateTableMember(night.table_id))) {
                    return fail('You are not a member of this table', 403);
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

            // ── RATE (submit full impression + auto-complete) ─────────────
            if (action === 'rate') {
                const {
                    table_night_id,
                    rating,
                    notes,
                    dish_description,
                    photo_url,
                    vibe_rating,
                    flavor_rating,
                    service_rating,
                    value_rating,
                } = body;

                if (!table_night_id) return fail('table_night_id is required');

                if (!isValidRating(rating)) {
                    return fail('Rating must be 0.5 to 5.0');
                }

                // Validate user is a participant and not already ready
                const { data: participant, error: partError } = await supabase
                    .from('table_night_participants')
                    .select('ready')
                    .eq('table_night_id', table_night_id)
                    .eq('user_id', user.id)
                    .single();

                if (partError) return fail('You are not a participant in this Round');
                if (participant.ready) return fail('You have already submitted your take');

                // Update participant row with ratings
                const { data: updated, error: updateError } = await supabase
                    .from('table_night_participants')
                    .update({
                        rating,
                        ready: true,
                        notes: notes?.trim() || null,
                        ...(isValidRating(vibe_rating) ? { vibe_rating } : {}),
                        ...(isValidRating(flavor_rating) ? { flavor_rating } : {}),
                        ...(isValidRating(service_rating) ? { service_rating } : {}),
                        ...(isValidRating(value_rating) ? { value_rating } : {}),
                    })
                    .eq('table_night_id', table_night_id)
                    .eq('user_id', user.id)
                    .select()
                    .single();

                if (updateError) throw updateError;

                // Create the attendee's journal entry
                const { data: night } = await supabase
                    .from('table_nights')
                    .select('table_id, restaurant_id')
                    .eq('id', table_night_id)
                    .single();

                if (night) {
                    const { error: entryError } = await supabase
                        .from('entries')
                        .insert({
                            user_id: user.id,
                            restaurant_id: night.restaurant_id,
                            table_id: night.table_id,
                            table_night_id,
                            rating,
                            content: notes?.trim() || null,
                            dish_description: dish_description?.trim() || null,
                            visibility: 'table',
                            ...(photo_url ? { photo_url } : {}),
                            ...(isValidRating(vibe_rating) ? { vibe_rating } : {}),
                            ...(isValidRating(flavor_rating) ? { flavor_rating } : {}),
                            ...(isValidRating(service_rating) ? { service_rating } : {}),
                            ...(isValidRating(value_rating) ? { value_rating } : {}),
                        });

                    if (entryError) {
                        console.error('Failed to create journal entry for participant:', entryError);
                    }
                }

                // Auto-complete: if all participants are now ready, set status to revealed
                const { data: allParticipants } = await supabase
                    .from('table_night_participants')
                    .select('ready')
                    .eq('table_night_id', table_night_id);

                const allReady = allParticipants && allParticipants.every((p: any) => p.ready);
                if (allReady) {
                    await supabase
                        .from('table_nights')
                        .update({ status: 'revealed', revealed_at: new Date().toISOString() })
                        .eq('id', table_night_id)
                        .eq('status', 'rating'); // idempotent guard
                }

                return json(updated);
            }

            // ── READY ─────────────────────────────────────────────────────
            if (action === 'ready') {
                const { table_night_id } = body;
                if (!table_night_id) return fail('table_night_id is required');

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

                const { data: night, error: nightError } = await supabase
                    .from('table_nights')
                    .select('host_user_id, status')
                    .eq('id', table_night_id)
                    .single();

                if (nightError) throw nightError;
                if (night.host_user_id !== user.id) return fail('Only the host can trigger reveal', 403);
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
                            display_name
                        )
                    `)
                    .eq('table_night_id', table_night_id);

                if (fullPartError) throw fullPartError;

                return json({ ...revealed, participants: fullParticipants });
            }

            return fail('Invalid action. Use: start, join, rate, ready, reveal');
        }

        return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('table-night error:', error);
        const message = error instanceof Error ? error.message : JSON.stringify(error);
        return new Response(
            JSON.stringify({ error: 'Internal Server Error', details: message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
