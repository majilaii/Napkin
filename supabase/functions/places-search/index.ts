import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { reportError } from '../_shared/report.ts';
import { upsertRestaurant } from '../_shared/restaurant.ts';
import {
    parsePayload,
    clamp,
    mapRegularOpeningHours,
    shouldGlobalFallback,
    WORLD_RECT_BIAS,
    type SearchPayload,
} from './utils.ts';

const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY');
const GOOGLE_PLACES_BASE_URL = 'https://places.googleapis.com/v1/places:searchText';
const GOOGLE_PLACE_DETAILS_BASE_URL = 'https://places.googleapis.com/v1/places';

// ── Internal-call support (TICKET-060 B2) ─────────────────────────────────────
// resolve-url's handleAsyncExtract calls places-search with the service-role key
// as the bearer token. auth.getUser(serviceKey) returns null (not a user JWT),
// causing a 401 that callPlacesSearch treats as an empty result, which silently
// skips Places verification and marks unverified ghosts as resolved.
//
// Fix: accept x-internal-secret === INTERNAL_CALL_SECRET (timingSafeEqual,
// fail-closed) and, when valid, skip the user-JWT check entirely.
// The service-role key is still needed for the supabase client (upsert), but
// auth.getUser is NOT called on the internal path.

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a[i] ^ b[i];
    }
    return diff === 0;
}

// Field mask shared between text-search and place-details responses.
// For details, drop the "places." prefix (single-place response).
const PLACE_FIELDS = [
    'id',
    'displayName',
    'formattedAddress',
    'addressComponents',
    'location',
    'types',
    'primaryType',
    'rating',
    'userRatingCount',
    'priceLevel',
    'websiteUri',
    'googleMapsUri',
    // TICKET-081: phone + structured hours for the restaurant-page metadata row.
    'nationalPhoneNumber',
    'regularOpeningHours',
    'photos',
    // TICKET-057: authorAttributions is nested under each photo object in Places v1.
    // This field provides the structured attribution data (displayName, uri) that we
    // synthesize into photoAttributionHtml for Google ToS compliance.
    'photos.authorAttributions',
];

/**
 * Minimal HTML escaper for synthesizing attribution anchor tags.
 * Replaces the five characters that must be escaped in HTML attribute values
 * and text content. Used to safely embed Places authorAttributions data.
 */
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function humanizeCuisine(raw: unknown): string | null {
    if (typeof raw !== 'string' || !raw) return null;
    // Drop the generic "_restaurant" suffix Google attaches to most cuisines
    // (e.g. "indian_restaurant" → "indian"). Leave non-restaurant types alone
    // ("bar", "bakery", "cafe") so they still render meaningfully.
    const stripped = raw.replace(/_restaurant$/i, '');
    if (!stripped) return null;
    return stripped
        .split('_')
        .map(part => part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : '')
        .join(' ');
}

function sanitizePlace(place: any) {
    let city: string | null = null;
    let country: string | null = null;
    if (Array.isArray(place.addressComponents)) {
        for (const component of place.addressComponents) {
            const types: string[] = component.types ?? [];
            if (types.includes('locality') || types.includes('postal_town')) {
                city = component.longText ?? component.shortText ?? null;
            }
            if (types.includes('country')) {
                country = component.longText ?? component.shortText ?? null;
            }
        }
    }

    const priceLevelMap: Record<string, number> = {
        PRICE_LEVEL_FREE: 0,
        PRICE_LEVEL_INEXPENSIVE: 1,
        PRICE_LEVEL_MODERATE: 2,
        PRICE_LEVEL_EXPENSIVE: 3,
        PRICE_LEVEL_VERY_EXPENSIVE: 4,
    };
    const priceLevel = place.priceLevel
        ? (priceLevelMap[place.priceLevel] ?? null)
        : null;

    // Google returns primaryType as a raw enum like "indian_restaurant",
    // "italian_restaurant", "bar", "bakery", "meal_takeaway". Strip the
    // generic "_restaurant" suffix and title-case the rest so we can
    // render it directly on the hero meta line ("Indian · London · $$$")
    // without any client-side transform.
    const cuisine: string | null = humanizeCuisine(place.primaryType);

    // TICKET-057: synthesized HTML from authorAttributions, NOT raw html_attributions.
    // The Places v1 API does not have a top-level html_attributions field. Instead it
    // returns structured authorAttributions per photo: [{ displayName, uri, photoUri }].
    // We synthesize a safe <a href="...">name</a> anchor here (escaping both fields)
    // so the client-side parser always sees a single, well-defined HTML shape regardless
    // of any future Google API changes. Only the first photo's first attribution is used
    // (AC 13 — first only). The escape-on-write contract means parsePlacesAttribution.ts
    // only ever receives HTML we produced — never raw third-party markup.
    const att = place.photos?.[0]?.authorAttributions?.[0];
    // First entry only — multiple attributions are deliberately discarded. See TICKET-057 AC 13.
    // Type-guard: only call escapeHtml on actual non-empty strings. A version-skewed
    // authorAttributions object with a non-string truthy field would otherwise throw
    // `s.replace is not a function` and 500 the entire search response. Falling through
    // to null degrades to AC 12 (sentinel path) — calm degradation per Heirloom.
    const displayName = typeof att?.displayName === 'string' && att.displayName.trim() !== ''
        ? att.displayName
        : null;
    const uri = typeof att?.uri === 'string' && att.uri.trim() !== '' ? att.uri : null;
    const photoAttributionHtml: string | null = displayName
        ? (uri
            ? `<a href="${escapeHtml(uri)}">${escapeHtml(displayName)}</a>`
            : escapeHtml(displayName))
        : null;

    return {
        id: place.id,
        name: place.displayName?.text ?? null,
        formattedAddress: place.formattedAddress ?? null,
        city,
        country,
        latitude: place.location?.latitude ?? null,
        longitude: place.location?.longitude ?? null,
        categories: place.types ?? [],
        cuisine,
        googleRating: place.rating ?? null,
        googleRatingCount: place.userRatingCount ?? null,
        priceLevel,
        photoReference: place.photos?.[0]?.name ?? null,
        photoAttributionHtml,
        website: place.websiteUri ?? null,
        link: place.googleMapsUri ?? null,
        // TICKET-081: metadata for the restaurant-page action row + hours line.
        // `google_maps_uri` is the canonical name the upsert + page consume;
        // `link` is kept above for backward-compat with any existing reader.
        phone: place.nationalPhoneNumber ?? null,
        google_maps_uri: place.googleMapsUri ?? null,
        hours: mapRegularOpeningHours(place.regularOpeningHours),
    };
}

serve(async req => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    // TICKET-037 (P2-8): guard against non-POST methods to prevent quota burn
    if (req.method !== 'POST') {
        return new Response(
            JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST only' } }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' } },
        );
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // ── Internal-call path (TICKET-060 B2) ────────────────────────────
        // resolve-url's handleAsyncExtract calls places-search using the service-role
        // key as a bearer, which fails auth.getUser → 401 → empty results →
        // unverified ghost marked resolved. Fix: accept x-internal-secret header
        // and skip user-JWT check when the secret is valid (timingSafeEqual, fail-closed).
        const INTERNAL_CALL_SECRET = Deno.env.get('INTERNAL_CALL_SECRET') ?? '';
        const callerSecret = req.headers.get('x-internal-secret') ?? '';
        const enc = new TextEncoder();
        const isInternalCall =
            INTERNAL_CALL_SECRET.length > 0 &&
            timingSafeEqualBytes(enc.encode(callerSecret), enc.encode(INTERNAL_CALL_SECRET));

        if (!isInternalCall) {
            // ── Auth gate (user-facing path) ───────────────────────────────
            const authHeader = req.headers.get('Authorization');
            if (!authHeader) {
                return new Response(
                    JSON.stringify({ error: 'Missing Authorization header' }),
                    { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                );
            }

            const token = authHeader.replace('Bearer ', '');
            const { data: { user }, error: userError } = await supabase.auth.getUser(token);
            if (userError || !user) {
                return new Response(
                    JSON.stringify({ error: 'Unauthorized' }),
                    { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                );
            }

            // ── Rate limit (TICKET-091) — every user-facing call costs a Google
            // Places request, so the bucket is checked fail-CLOSED: an RPC error
            // denies rather than letting a DB blip uncork unlimited spend.
            // 120/hr ≈ 40 typed searches at the 250ms debounce — generous for a
            // human, ruinous for a loop.
            const { data: rateRows, error: rateError } = await supabase.rpc(
                'check_and_increment_rate_limit',
                { p_user_id: user.id, p_bucket_key: 'places_search', p_max: 120, p_window_seconds: 3600 },
            );
            const rateRow = rateRows?.[0];
            if (rateError || !rateRow || !rateRow.allowed) {
                if (rateError) console.error('places-search rate check failed:', rateError);
                const retryAfter = rateRow?.retry_after_seconds ?? 60;
                return new Response(
                    JSON.stringify({
                        error: {
                            code: 'RATE_LIMITED',
                            message: 'Too many searches — try again shortly',
                            details: { retry_after_seconds: retryAfter },
                        },
                    }),
                    { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                );
            }
        }
        // On the internal path: no auth.getUser call; supabase client uses service-role
        // key. Internal calls are already throttled upstream by resolve-url's buckets.

        // ── API key check ──────────────────────────────────────────────────
        if (!GOOGLE_PLACES_API_KEY) {
            return new Response(
                JSON.stringify({ error: 'GOOGLE_PLACES_API_KEY is not configured' }),
                {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                },
            );
        }

        const payload: SearchPayload = await parsePayload(req);
        console.log('Google Places search payload:', payload);
        const query = payload.query?.trim();
        const placeId = payload.place_id?.trim();

        if (!query && !placeId) {
            return new Response(
                JSON.stringify({ error: 'Missing query or place_id parameter' }),
                {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                },
            );
        }

        // ── Branch A: lookup by place_id (Place Details) ─────────────────
        if (placeId) {
            // TICKET-081 fix-pass: pin languageCode=en so regularOpeningHours
            // weekdayDescriptions come back with English day-name prefixes. The
            // restaurant page derives "today" by matching that day name (never by
            // array position, which is locale-dependent), so deterministic English
            // labels are required for the match to fire.
            const detailsUrl = `${GOOGLE_PLACE_DETAILS_BASE_URL}/${encodeURIComponent(placeId)}?languageCode=en`;
            const detailsRes = await fetch(detailsUrl, {
                method: 'GET',
                headers: {
                    'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
                    'X-Goog-FieldMask': PLACE_FIELDS.join(','),
                },
            });
            const detailsBody = await detailsRes.json();
            if (!detailsRes.ok) {
                console.error('Place Details error:', detailsBody);
                return new Response(
                    JSON.stringify({
                        error: detailsBody?.error?.message || 'Place Details request failed',
                        details: detailsBody,
                    }),
                    {
                        status: detailsRes.status,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    },
                );
            }

            const sanitized = sanitizePlace(detailsBody);
            let restaurantId: string | null = null;

            // Opportunistic upsert: when persist=true, mirror the place into
            // restaurants. _shared/restaurant.ts handles non-destructive merge
            // and Storage hero-photo mirroring.
            if (payload.persist && sanitized.id && sanitized.name) {
                try {
                    restaurantId = await upsertRestaurant(supabase, {
                        external_id: sanitized.id,
                        name: sanitized.name,
                        location: {
                            address: sanitized.formattedAddress ?? undefined,
                            locality: sanitized.city ?? undefined,
                            country: sanitized.country ?? undefined,
                        },
                        latitude: sanitized.latitude ?? undefined,
                        longitude: sanitized.longitude ?? undefined,
                        photoReference: sanitized.photoReference ?? undefined,
                        photoAttributionHtml: sanitized.photoAttributionHtml ?? null,
                        googleRating: sanitized.googleRating ?? undefined,
                        googleRatingCount: sanitized.googleRatingCount ?? undefined,
                        priceLevel: sanitized.priceLevel ?? undefined,
                        cuisine: sanitized.cuisine ?? undefined,
                        // TICKET-081: persist metadata on the same backfill upsert.
                        phone: sanitized.phone ?? undefined,
                        website: sanitized.website ?? undefined,
                        googleMapsUri: sanitized.google_maps_uri ?? undefined,
                        hours: sanitized.hours ?? undefined,
                    });
                } catch (e) {
                    // Persist failure is non-fatal; the client still gets the
                    // sanitized place to render a ghost.
                    console.error('Persist upsert failed:', e);
                }
            }

            return new Response(
                // Echo the upserted Napkin id (when persist minted/merged a row) so
                // callers that need a restaurant_id — e.g. the Top 4 picker featuring
                // a never-logged place — can use it without a second round-trip.
                JSON.stringify({ data: [{ ...sanitized, restaurant_id: restaurantId }] }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        // ── Branch B: text search (existing behaviour) ────────────────────

        // Build the request body for Google Places Text Search
        // TICKET-081 fix-pass: languageCode=en pins English weekday-name prefixes in
        // regularOpeningHours.weekdayDescriptions (the page matches "today" by day name,
        // not by locale-dependent array position).
        const requestBody: any = {
            textQuery: query,
            maxResultCount: clamp(payload.limit ?? 5, 1, 20),
            languageCode: 'en',
        };

        // Add location bias if coordinates provided
        if (typeof payload.latitude === 'number' && typeof payload.longitude === 'number') {
            requestBody.locationBias = {
                circle: {
                    center: {
                        latitude: payload.latitude,
                        longitude: payload.longitude,
                    },
                    radius: payload.radius ?? 5000,
                },
            };
        }

        // Extended field mask to include rating, price, and address components
        const fieldMask = PLACE_FIELDS.map(f => `places.${f}`).join(',');

        const runTextSearch = async (body: any) => {
            const res = await fetch(GOOGLE_PLACES_BASE_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
                    'X-Goog-FieldMask': fieldMask,
                },
                body: JSON.stringify(body),
            });
            return { ok: res.ok, status: res.status, body: await res.json() };
        };

        const upstream = await runTextSearch(requestBody);

        if (!upstream.ok) {
            console.error('Google Places API error:', upstream.body);
            return new Response(
                JSON.stringify({
                    error: upstream.body?.error?.message || 'Google Places request failed',
                    details: upstream.body,
                }),
                {
                    status: upstream.status,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                },
            );
        }

        // Transform to normalized shape for Napkin clients
        let sanitized = (upstream.body?.places ?? []).map(sanitizePlace);

        // ── TICKET-174: global fallback pass ──────────────────────────────
        // A tight bias circle legitimately returns zero for a distant name
        // ("kamer" from London misses the Amsterdam restaurant). When the
        // caller opted in AND the first pass was biased AND it came back
        // empty, re-run the same query with a world rectangle bias and tag
        // the rows so the client can render them as farther afield.
        // Best-effort: a fallback error degrades to the empty first pass.
        // Cost note: this doubles Google calls only on the zero-result path;
        // the 120/hr places_search bucket counts edge invocations, so the
        // retry is invisible to the limiter — accepted at friends-test scale.
        if (shouldGlobalFallback(payload, sanitized.length)) {
            try {
                const fallback = await runTextSearch({
                    ...requestBody,
                    locationBias: WORLD_RECT_BIAS,
                });
                if (fallback.ok) {
                    sanitized = (fallback.body?.places ?? [])
                        .map(sanitizePlace)
                        .map((p: ReturnType<typeof sanitizePlace>) => ({ ...p, fartherAfield: true }));
                } else {
                    console.error('Global fallback pass failed:', fallback.body);
                }
            } catch (e) {
                console.error('Global fallback pass threw:', e);
            }
        }

        return new Response(JSON.stringify({ data: sanitized }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Edge function error', error);
        reportError(error, { fn: 'places-search' });
        return new Response(
            JSON.stringify({ error: 'Unexpected error', details: String(error) }),
            {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
        );
    }
});
