import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { upsertRestaurant } from '../_shared/restaurant.ts';
import { errorResponse, mapPgError } from '../_shared/errors.ts';
import { emitFriendLogged } from '../_shared/notify.ts';
import { coerceClientNonce } from '../_shared/uuid.ts';

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
                            table_night_id,
                            profiles:user_id (
                                display_name,
                                avatar_url
                            )
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

                    const profile = Array.isArray(entry.profiles) ? entry.profiles[0] : entry.profiles;
                    filtered.push({
                        id: entry.id,
                        user_id: entry.user_id,
                        rating: entry.rating ?? null,
                        visited_at: entry.visited_at ?? entry.created_at,
                        created_at: entry.created_at,
                        display_name: profile?.display_name ?? 'User',
                        avatar_url: profile?.avatar_url ?? null,
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

                return new Response(
                    JSON.stringify({
                        data: {
                            entry_id: top.id,
                            user_id: top.user_id,
                            rating: top.rating,
                            visited_at: top.visited_at,
                            display_name: top.display_name,
                            avatar_url: top.avatar_url,
                        }
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
                    ...(mPhotoUrl ? { photo_url: mPhotoUrl } : {}),
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

                // Idempotency key (TICKET-036 wires client; RPC handles dedup)
                client_nonce,
            } = body;

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
                visibility: visibility ?? 'private',
                ...(vibe_rating != null ? { vibe_rating } : {}),
                ...(flavor_rating != null ? { flavor_rating } : {}),
                ...(service_rating != null ? { service_rating } : {}),
                ...(value_rating != null ? { value_rating } : {}),
                // TICKET-075: always include `liked` (RPC COALESCEs to false anyway,
                // but sending it explicitly keeps the wire shape stable).
                liked: liked === true,
                ...(heroPhotoUrl ? { photo_url: heroPhotoUrl } : {}),
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
                return new Response(
                    JSON.stringify({
                        data: {
                            ...(existingEntry ?? { id: entryId }),
                            table_id: effectiveTableIds[0] ?? null,
                            table_ids: effectiveTableIds,
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

            // entry_participants were inserted atomically in fn_create_entry_with_tables RPC.

            // ── Insert entry_companions (non-fatal, outside atomic RPC — finding 16) ──
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

            return new Response(
                JSON.stringify({
                    // TICKET-043: author-facing response includes table_ids[].
                    // Member-facing reads (table-activity, entry detail by non-author)
                    // MUST omit table_ids[] and rewrite table_id to the requesting Table's id.
                    data: {
                        ...entryData,
                        table_id: effectiveTableIds[0] ?? null,  // primary (legacy mirror)
                        table_ids: effectiveTableIds,            // author-facing only
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
