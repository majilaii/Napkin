import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

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
 * - (no action): Create a new entry, optionally tagging participant_ids
 * - add-take: Update the caller's entry_participants row with their rating/notes
 */

// Food establishment types from Google Places
const FOOD_TYPES = ['restaurant', 'cafe', 'bar', 'bakery', 'meal_takeaway', 'food', 'meal_delivery'];

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

        if (req.method === 'POST') {
            const body = await req.json();
            console.log('entry function called with body:', JSON.stringify(body));

            // ── add-take action ────────────────────────────────────────────
            if (body.action === 'add-take') {
                const { entry_id, rating, notes } = body;

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

                // Entry data
                rating,
                content,
                dish_description,
                cooked_by,
                value_profile,
                visited_at,

                // Table sharing (optional)
                table_id,
                visibility,

                // Collaborative (optional)
                participant_ids,
            } = body;

            let restaurantId: string | null = null;
            let placeId: string | null = null;
            let userPlaceId: string | null = user_place_id || null;

            // Handle restaurant location
            if (restaurant?.external_id) {
                const isRestaurant = restaurant.types?.some((t: string) => FOOD_TYPES.includes(t)) ?? true;

                if (isRestaurant) {
                    // Upsert to restaurants table
                    const { data: restaurantData, error: restaurantError } = await supabase
                        .from('restaurants')
                        .upsert({
                            external_id: restaurant.external_id,
                            name: restaurant.name,
                            address: restaurant.location?.address,
                            city: restaurant.location?.locality,
                            country: restaurant.location?.country,
                            lat: restaurant.latitude,
                            lng: restaurant.longitude,
                        }, { onConflict: 'external_id' })
                        .select('id')
                        .single();

                    if (restaurantError) throw restaurantError;
                    restaurantId = restaurantData.id;
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

            // Prepare participant list before creating entry
            const ratingValue = (rating === 0 || rating === undefined || rating === null) ? null : rating;
            const visitedAtValue = visited_at ? new Date(visited_at).toISOString() : new Date().toISOString();
            const extraParticipantIds: string[] = Array.isArray(participant_ids) ? participant_ids : [];

            // Validate all tagged participants are members of the target table
            if (table_id && extraParticipantIds.length > 0) {
                const { data: members } = await supabase
                    .from('table_members')
                    .select('member_id')
                    .eq('table_id', table_id)
                    .in('member_id', extraParticipantIds);

                const memberSet = new Set((members ?? []).map((m: { member_id: string }) => m.member_id));
                const nonMembers = extraParticipantIds.filter((id: string) => !memberSet.has(id));
                if (nonMembers.length > 0) {
                    return new Response(
                        JSON.stringify({ error: `Some participants are not members of this table: ${nonMembers.join(', ')}` }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }
            }

            // Create entry
            const { data: entryData, error: entryError } = await supabase
                .from('entries')
                .insert({
                    user_id: user.id,
                    restaurant_id: restaurantId,
                    place_id: placeId,
                    user_place_id: userPlaceId,
                    rating: ratingValue,
                    content: content?.trim() || null,
                    dish_description: dish_description?.trim() || null,
                    cooked_by: cooked_by?.trim() || null,
                    value_profile: value_profile || null,
                    visited_at: visitedAtValue,
                    ...(table_id ? { table_id } : {}),
                    ...(visibility ? { visibility } : {}),
                })
                .select()
                .single();

            if (entryError) {
                console.error('Entry insert error:', entryError);
                throw entryError;
            }

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

            // Insert entry_participants
            // Always include the creator; deduplicate in case creator is in participant_ids
            const allParticipantIds = [user.id, ...extraParticipantIds.filter((id: string) => id !== user.id)];

            const participantRows = allParticipantIds.map((pid: string) => ({
                entry_id: entryData.id,
                user_id: pid,
                rating: pid === user.id ? ratingValue : null,
                notes: pid === user.id ? (content?.trim() || null) : null,
            }));

            const { error: partInsertError } = await supabase
                .from('entry_participants')
                .insert(participantRows);

            if (partInsertError) {
                console.error('entry_participants insert error:', partInsertError);
                throw partInsertError;
            }

            console.log('Entry created:', entryData.id);

            return new Response(
                JSON.stringify({ data: entryData }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('entry function error:', error);
        return new Response(
            JSON.stringify({ error: 'Internal Server Error', details: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
