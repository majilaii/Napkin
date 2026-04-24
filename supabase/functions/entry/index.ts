import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { upsertRestaurant } from '../_shared/restaurant.ts';
import { errorResponse, mapPgError } from '../_shared/errors.ts';

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
                    googleRating: rInput.googleRating ?? rInput.rating,
                    googleRatingCount: rInput.googleRatingCount ?? rInput.userRatingCount,
                    priceLevel: rInput.priceLevel,
                    cuisine: rInput.cuisine,
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

                // User-uploaded photo(s) (optional, public URLs from Supabase Storage)
                photo_url,
                photo_urls,

                // Table sharing (optional)
                table_id,
                visibility,

                // Collaborative (optional)
                participant_ids,

                // Companion tagging (optional; distinct from participant_ids)
                // companion_ids = who was there; participant_ids = Round raters
                companion_ids,

                // Idempotency key (TICKET-036 wires client; minimal support here)
                client_nonce,
            } = body;

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
                        googleRating: restaurant.googleRating,
                        googleRatingCount: restaurant.googleRatingCount,
                        priceLevel: restaurant.priceLevel,
                        cuisine: restaurant.cuisine,
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

            // Prepare participant list before creating entry
            const ratingValue = (rating === 0 || rating === undefined || rating === null) ? null : rating;
            const visitedAtValue = visited_at ? new Date(visited_at).toISOString() : new Date().toISOString();
            const extraParticipantIds: string[] = Array.isArray(participant_ids) ? participant_ids : [];

            // table_id is optional — entries without one live on the user's feed only.
            let resolvedTableId: string | undefined = table_id;

            // Validate all tagged participants are members of the target table
            if (resolvedTableId && extraParticipantIds.length > 0) {
                const { data: members } = await supabase
                    .from('table_members')
                    .select('member_id')
                    .eq('table_id', resolvedTableId)
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

            // Derive hero photo URL: explicit photo_url takes priority, then first of photo_urls
            const photoUrlsArray: string[] = Array.isArray(photo_urls) ? photo_urls : [];
            const heroPhotoUrl = photo_url || photoUrlsArray[0] || null;

            // Check for duplicate submission via client_nonce (TICKET-036 hook)
            if (client_nonce) {
                const { data: existing, error: nonceErr } = await supabase
                    .from('entries')
                    .select()
                    .eq('user_id', user.id)
                    .eq('client_nonce', client_nonce)
                    .maybeSingle();
                if (!nonceErr && existing) {
                    return new Response(
                        JSON.stringify({ data: existing, warnings: [{ type: 'duplicate_submission' }] }),
                        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
                    ...(vibe_rating != null ? { vibe_rating } : {}),
                    ...(flavor_rating != null ? { flavor_rating } : {}),
                    ...(service_rating != null ? { service_rating } : {}),
                    ...(value_rating != null ? { value_rating } : {}),
                    ...(heroPhotoUrl ? { photo_url: heroPhotoUrl } : {}),
                    ...(resolvedTableId ? { table_id: resolvedTableId } : {}),
                    ...(visibility ? { visibility } : {}),
                    ...(client_nonce ? { client_nonce } : {}),
                })
                .select()
                .single();

            if (entryError) {
                console.error('Entry insert error:', entryError);
                throw entryError;
            }

            // Bulk-insert entry_photos if photo_urls provided (non-fatal if it fails)
            if (photoUrlsArray.length > 0) {
                const photoRows = photoUrlsArray.map((url: string, idx: number) => ({
                    entry_id: entryData.id,
                    photo_url: url,
                    sort_order: idx,
                }));
                const { error: photosError } = await supabase
                    .from('entry_photos')
                    .insert(photoRows);
                if (photosError) {
                    console.error('entry_photos insert error (non-fatal):', photosError);
                }
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

            // Insert entry_companions (companion tagging — NOT Round participants)
            // companion_ids: arbitrary Napkin users; no Table-membership gate (Instagram-style)
            // TICKET-037 (P1-11): explicitly exclude allParticipantIds so a user can't appear
            // in both the "6 ratings" strip and the "with X" companions list.
            const rawCompanionIds: string[] = Array.isArray(companion_ids) ? companion_ids : [];
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

            return new Response(
                JSON.stringify({
                    data: entryData,
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
        return new Response(
            JSON.stringify({ error: 'Internal Server Error', details: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
