import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { reportError } from '../_shared/report.ts';
import {
    buildTextSearchPlan,
    clamp,
    expectedSearchOwnerDecision,
    parsePayload,
    projectionToPlace,
    resolveGlobalFallback,
    type SearchPayload,
    shouldGlobalFallback,
    WORLD_RECT_BIAS,
} from './utils.ts';
import {
    CompletenessPaidPathError,
    CompletenessProvider,
} from '../_shared/completenessProvider.ts';
import {
    type GoogleTextCandidate,
    humanizeCuisine,
    mapGooglePriceLevel,
    mapRegularOpeningHours,
} from '../_shared/completeness.ts';

const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY');

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

    const priceLevel = mapGooglePriceLevel(place.priceLevel);

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

type SearchCandidate = GoogleTextCandidate & { fartherAfield?: boolean };

function textCandidateToPlace(candidate: SearchCandidate) {
    const raw = candidate.raw as any;
    return {
        ...sanitizePlace(raw),
        id: candidate.externalId,
        name: candidate.name,
        formattedAddress: candidate.formattedAddress,
        city: candidate.city,
        // Text Search deliberately uses the frozen Pro mask, not the full
        // Details mask. The detail screen may therefore enrich this true ghost
        // once, while complete payloads continue to bypass Place Details.
        deferred: true,
        ...(candidate.fartherAfield === true ? { fartherAfield: true } : {}),
    };
}

async function mintResolution(
    supabase: any,
    userId: string,
    importNonce: string | null,
    matchedExternalId: string,
    evidence: unknown,
): Promise<string> {
    const { data, error } = await supabase
        .from('import_resolutions')
        .insert({
            user_id: userId,
            import_nonce: importNonce,
            candidate_evidence: evidence,
            decision: 'matched',
            matched_external_id: matchedExternalId,
            scores: null,
        })
        .select('resolution_id')
        .single();
    if (error || !data?.resolution_id) throw error ?? new Error('resolution insert returned no id');
    return data.resolution_id as string;
}

function response(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
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
        const rawPayload = req.headers.get('content-type')?.includes('application/json')
            ? await req.clone().json().catch(() => null)
            : null;
        const payload: SearchPayload = await parsePayload(req);

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

        let ownerId: string;

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
            ownerId = user.id;

            const expectedOwner = expectedSearchOwnerDecision(payload.expected_owner_id, ownerId);
            if (expectedOwner === 'invalid') {
                return response({
                    error: {
                        code: 'INVALID_EXPECTED_OWNER',
                        message: 'expected_owner_id must be a UUID',
                    },
                }, 400);
            }
            if (expectedOwner === 'mismatch') {
                return response({
                    error: {
                        code: 'EXPECTED_OWNER_MISMATCH',
                        message: 'Import manifest belongs to a different signed-in account',
                    },
                }, 403);
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
        } else {
            // Internal resolve_content calls still charge the real job owner.
            // The owner header is trusted only after the timing-safe secret gate.
            const internalOwner = req.headers.get('x-owner-id') ?? '';
            const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuid.test(internalOwner)) return response({ error: 'Missing internal owner' }, 400);
            ownerId = internalOwner;
        }
        // On the internal path: no auth.getUser call; supabase client uses service-role
        // key. Internal calls are already throttled upstream by resolve-url's buckets.

        const query = payload.query?.trim();
        const placeId = payload.place_id?.trim();
        const claimant = crypto.randomUUID();
        const provider = new CompletenessProvider(supabase, {
            googleApiKey: GOOGLE_PLACES_API_KEY ?? '',
            spendFrozen: Deno.env.get('COMPLETENESS_SPEND_FROZEN') === 'true',
        });
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const importNonce = typeof payload.import_nonce === 'string' && uuid.test(payload.import_nonce)
            ? payload.import_nonce
            : null;

        // Edited/manual picker matches always mint FRESH server authority.
        // Stored evidence is reusable only when it already attests the same id;
        // otherwise Details is re-derived through the shared cache/budget path.
        if (payload.action === 'match_correction') {
            const chosenExternalId = payload.chosen_external_id?.trim() ?? '';
            if (!importNonce || !chosenExternalId) {
                return response({ error: 'import_nonce and chosen_external_id are required' }, 400);
            }

            let evidence: unknown = null;
            if (payload.prior_resolution_id && uuid.test(payload.prior_resolution_id)) {
                const { data: prior, error: priorError } = await supabase
                    .from('import_resolutions')
                    .select('candidate_evidence,matched_external_id,decision')
                    .eq('resolution_id', payload.prior_resolution_id)
                    .eq('user_id', ownerId)
                    .maybeSingle();
                if (priorError) throw priorError;
                if (prior?.decision === 'matched' && prior.matched_external_id === chosenExternalId) {
                    evidence = { reused_resolution_id: payload.prior_resolution_id, stored: prior.candidate_evidence };
                }
            }
            if (!evidence) {
                const projection = await provider.attest(ownerId, chosenExternalId, claimant);
                evidence = { attestation: projection };
            }
            const resolutionId = await mintResolution(
                supabase,
                ownerId,
                importNonce,
                chosenExternalId,
                evidence,
            );
            return response({ data: { resolution_id: resolutionId, external_id: chosenExternalId } });
        }

        if (!query && !placeId) {
            return response({ error: 'Missing query or place_id parameter' }, 400);
        }

        const ownsResolution = req.headers.get('x-candidate-consumer') !== 'resolve-url';

        // ── Branch A: lookup by place_id (Enterprise Details attestation) ──
        if (placeId) {
            const projection = await provider.attest(ownerId, placeId, claimant);
            const sanitized = projectionToPlace(projection);
            let restaurantId: string | null = null;
            if (payload.persist) {
                const { data: existing, error: existingError } = await supabase
                    .from('restaurants')
                    .select('id')
                    .eq('external_id', placeId)
                    .maybeSingle();
                if (existingError) throw existingError;
                const persisted = await provider.persistAttestedRestaurant(
                    ownerId,
                    existing?.id ?? null,
                    projection,
                    claimant,
                    true,
                );
                restaurantId = persisted.restaurant_id;
            }
            const resolutionId = ownsResolution
                ? await mintResolution(supabase, ownerId, importNonce, placeId, { attestation: projection })
                : null;
            return response({
                data: [{ ...sanitized, restaurant_id: restaurantId, resolution_id: resolutionId }],
            });
        }

        // ── Branch B: Text Search (separate endpoint/mask/debit) ──────────
        let textSearchPlan = buildTextSearchPlan(payload, rawPayload ?? payload);
        if (textSearchPlan.needsHomeCity) {
            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('home_city')
                .eq('user_id', ownerId)
                .maybeSingle();
            if (profileError) {
                console.error('places-search home city lookup failed:', profileError);
            } else if (typeof profile?.home_city === 'string') {
                textSearchPlan = buildTextSearchPlan(
                    payload,
                    rawPayload ?? payload,
                    profile.home_city,
                );
            }
        }

        let candidates: SearchCandidate[] = await provider.searchText(ownerId, {
            name: query!,
            city: textSearchPlan.city,
            area: textSearchPlan.area,
            address: null,
        }, claimant, textSearchPlan.coordinateBias
            ? {
                bias: {
                    circle: {
                        ...textSearchPlan.coordinateBias,
                        radius: 50000,
                    },
                },
            }
            : undefined);

        if (shouldGlobalFallback(payload, textSearchPlan.coordinateBias, candidates.length)) {
            candidates = await resolveGlobalFallback<SearchCandidate>({
                firstPassRows: candidates,
                consumeRateUnit: async () => {
                    const { data: rateRows, error: rateError } = await supabase.rpc(
                        'check_and_increment_rate_limit',
                        {
                            p_user_id: ownerId,
                            p_bucket_key: 'places_search',
                            p_max: 120,
                            p_window_seconds: 3600,
                        },
                    );
                    if (rateError) {
                        console.error('places-search fallback rate check failed:', rateError);
                        return false;
                    }
                    return rateRows?.[0]?.allowed === true;
                },
                fetchFallback: async signal => {
                    const fallback = await provider.searchText(ownerId, {
                        name: query!,
                        city: textSearchPlan.city,
                        area: textSearchPlan.area,
                        address: null,
                    }, claimant, { bias: WORLD_RECT_BIAS, signal });
                    return {
                        ok: true,
                        rows: fallback.map(candidate => ({
                            ...candidate,
                            fartherAfield: true,
                        })),
                    };
                },
            });
        }
        const limited = candidates.slice(0, clamp(payload.limit ?? 5, 1, 5));
        const sanitized = await Promise.all(limited.map(async (candidate) => ({
            ...textCandidateToPlace(candidate),
            resolution_id: ownsResolution
                ? await mintResolution(
                    supabase,
                    ownerId,
                    importNonce,
                    candidate.externalId,
                    { text_search_candidate: candidate.raw },
                )
                : null,
        })));

        return response({ data: sanitized });
    } catch (error) {
        console.error('Edge function error', error);
        reportError(error, { fn: 'places-search' });
        if (error instanceof CompletenessPaidPathError) {
            const status = error.code === 'BUDGET_DEFERRED'
                ? 429
                : error.code === 'CLAIM_PENDING'
                ? 503
                : error.providerStatus ?? 502;
            return response({
                error: {
                    code: error.code,
                    message: error.message,
                },
            }, status);
        }
        return response({ error: 'Unexpected error', details: String(error) }, 500);
    }
});
