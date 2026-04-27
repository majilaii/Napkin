/**
 * resolve-url edge function — TICKET-053
 *
 * POST { url: string }
 * 1. validateUrl
 * 2. check_and_increment_rate_limit (30/hr per user)
 * 3. Source detection from URL host pattern
 * 4. oEmbed (TikTok) or <title>/JSON-LD unfurl (web) — 8s overall timeout
 * 5. Internal HTTP call to places-search to resolve candidates
 * 6. Join restaurants.external_id → restaurant_id
 * 7. Join wishlist_items for already_wishlisted per candidate
 * 8. Build ResolveUrlResponse (including note_prefill from captionToNote)
 *
 * Error mapping [M4]:
 * - TikTok oEmbed 200 valid → success
 * - TikTok oEmbed 200 malformed/empty → zero-candidate (empty candidates)
 * - TikTok oEmbed 400/404 → zero-candidate
 * - TikTok oEmbed 429 → 503 UPSTREAM_RATE_LIMITED
 * - TikTok oEmbed 5xx / timeout → 503 UPSTREAM_UNAVAILABLE
 * - Places 200 empty → zero-candidate (best_query prefilled)
 * - Places 429 → 503 PLACES_RATE_LIMITED
 * - Places 5xx / timeout → 503 UPSTREAM_UNAVAILABLE
 * - Overall 8s timeout → 503 TIMEOUT
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { validateUrl } from '../_shared/urlValidation.ts';
import type { WishlistSourceTikTok } from '../_shared/wishlistSource.ts';
import { captionToNote } from '../_shared/captionToNote.ts';

// ── Types ─────────────────────────────────────────────────────────────────────

type SourceType = 'tiktok' | 'google_maps' | 'web';
type Confidence = 'exact' | 'high' | 'low';

/** Shape identical to places-search output */
interface PlacesPayload {
    id: string;
    name: string | null;
    formattedAddress: string | null;
    city: string | null;
    country: string | null;
    latitude: number | null;
    longitude: number | null;
    categories: string[];
    cuisine: string | null;
    googleRating: number | null;
    googleRatingCount: number | null;
    priceLevel: number | null;
    photoReference: string | null;
    website: string | null;
    link: string | null;
    external_id: string;
    // Fields added for wishlist add compatibility
    location?: {
        address?: string;
        locality?: string;
        country?: string;
    };
}

interface ResolvedCandidate {
    restaurant: PlacesPayload;
    confidence: Confidence;
    google_place_id: string;
    restaurant_id: string | null;
    already_wishlisted: boolean;
}

interface ResolveUrlResponse {
    source_type: SourceType;
    best_query: string | null;
    note_prefill: string;
    candidates: ResolvedCandidate[];
    partial_source: Omit<WishlistSourceTikTok, 'type' | 'url'> | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function errorResponse(code: string, message: string, status: number, details?: unknown) {
    return jsonResponse({ error: { code, message, details } }, status);
}

/** Detect source type from URL host pattern */
function detectSourceType(url: URL): SourceType {
    const host = url.hostname.toLowerCase();
    if (
        host === 'tiktok.com' ||
        host === 'www.tiktok.com' ||
        host === 'vm.tiktok.com' ||
        host === 'm.tiktok.com'
    ) {
        return 'tiktok';
    }
    if (
        host === 'maps.app.goo.gl' ||
        host === 'maps.google.com' ||
        host === 'www.google.com' && url.pathname.startsWith('/maps') ||
        host === 'goo.gl'
    ) {
        return 'google_maps';
    }
    return 'web';
}

// captionToNote: imported from canonical _shared module (de-forked 2026-04-26)

/**
 * Fetch TikTok oEmbed data.
 * Returns null on any non-retryable failure (400/404); throws on retryable (429/5xx/timeout).
 */
async function fetchTikTokOEmbed(
    url: string,
    signal: AbortSignal,
): Promise<{ title: string; author_unique_id?: string; author_name?: string; thumbnail_url?: string; embed_product_id?: string } | null> {
    const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
    let res: Response;
    try {
        res = await fetch(endpoint, { signal });
    } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e;
        throw { code: 'UPSTREAM_UNAVAILABLE', retryable: true };
    }

    if (res.status === 400 || res.status === 404) {
        return null; // zero-candidate
    }
    if (res.status === 429) {
        throw { code: 'UPSTREAM_RATE_LIMITED', retryable: true };
    }
    if (res.status >= 500) {
        throw { code: 'UPSTREAM_UNAVAILABLE', retryable: true };
    }
    if (!res.ok) {
        return null; // treat other 4xx as zero-candidate
    }

    let json: any;
    try {
        json = await res.json();
    } catch {
        return null; // malformed JSON → zero-candidate
    }

    if (!json || typeof json.title !== 'string') return null;

    return {
        title: json.title,
        author_unique_id: json.author_unique_id ?? undefined,
        author_name: json.author_name ?? undefined,
        thumbnail_url: json.thumbnail_url ?? undefined,
        embed_product_id: json.embed_product_id ?? undefined,
    };
}

/**
 * Unfurl a generic web URL: fetch <title> and JSON-LD.
 * Returns extracted name/query candidate or null on failure.
 * Non-fatal — always returns null rather than throwing.
 */
async function unfurlWebTitle(url: string, signal: AbortSignal): Promise<string | null> {
    try {
        const res = await fetch(url, {
            signal,
            headers: { 'User-Agent': 'Napkin/1.0 (link-resolver; +https://napkin.app)' },
        });
        if (!res.ok) return null;
        const text = await res.text().catch(() => null);
        if (!text) return null;
        const titleMatch = text.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
        return titleMatch ? titleMatch[1].trim() : null;
    } catch {
        return null;
    }
}

/**
 * Call the internal places-search edge function via HTTP.
 */
async function callPlacesSearch(
    query: string,
    authHeader: string,
    supabaseUrl: string,
    supabaseAnonKey: string,
    signal: AbortSignal,
): Promise<PlacesPayload[]> {
    let res: Response;
    try {
        res = await fetch(`${supabaseUrl}/functions/v1/places-search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: authHeader,
                apikey: supabaseAnonKey,
            },
            body: JSON.stringify({ query, limit: 3 }),
            signal,
        });
    } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e;
        throw { code: 'UPSTREAM_UNAVAILABLE', retryable: true };
    }

    if (res.status === 429) {
        throw { code: 'PLACES_RATE_LIMITED', retryable: true };
    }
    if (res.status >= 500) {
        throw { code: 'UPSTREAM_UNAVAILABLE', retryable: true };
    }
    if (!res.ok) {
        return []; // 4xx from places = no results
    }

    let body: any;
    try {
        body = await res.json();
    } catch {
        return [];
    }

    // places-search wraps result in { data: { candidates: [...] } } or { data: [...] }
    const candidates = body?.data?.candidates ?? body?.data ?? body?.candidates ?? [];
    return Array.isArray(candidates) ? candidates : [];
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
        return errorResponse('METHOD_NOT_ALLOWED', 'POST only', 405);
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
        return errorResponse('UNAUTHORIZED', 'Missing Authorization header', 401);
    }

    const token = authHeader.replace('Bearer ', '');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
        return errorResponse('UNAUTHORIZED', 'Unauthorized', 401);
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    let body: { url?: string };
    try {
        body = await req.json();
    } catch {
        return errorResponse('INVALID_BODY', 'Request body must be JSON', 400);
    }

    const rawUrl = body?.url;
    if (typeof rawUrl !== 'string') {
        return errorResponse('INVALID_URL', 'url is required', 400);
    }

    // ── URL validation [M2] ───────────────────────────────────────────────────
    const urlResult = validateUrl(rawUrl);
    if (!urlResult.ok) {
        return errorResponse('INVALID_URL', `URL rejected: ${urlResult.reason}`, 400);
    }
    const parsedUrl = urlResult.url;

    // ── Rate limit [H3] ───────────────────────────────────────────────────────
    const { data: rateRows, error: rateError } = await supabase.rpc(
        'check_and_increment_rate_limit',
        { p_user_id: user.id, p_bucket_key: 'resolve_url', p_max: 30, p_window_seconds: 3600 },
    );
    if (rateError) {
        console.error('Rate limit check failed:', rateError);
        // Non-fatal — allow the request if the rate-limit RPC fails (fail-open)
    } else {
        const row = rateRows?.[0];
        if (row && !row.allowed) {
            return jsonResponse(
                { error: { code: 'RATE_LIMITED', message: 'Too many requests', details: { retry_after_seconds: row.retry_after_seconds } } },
                429,
            );
        }
    }

    // ── Source detection ──────────────────────────────────────────────────────
    const sourceType = detectSourceType(parsedUrl);

    // ── 8-second overall timeout ──────────────────────────────────────────────
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 8000);

    try {
        let query: string | null = null;
        let notePrefill = '';
        let partialSource: Omit<WishlistSourceTikTok, 'type' | 'url'> | null = null;

        // ── TikTok: oEmbed → caption → query ─────────────────────────────────
        if (sourceType === 'tiktok') {
            let oEmbed: Awaited<ReturnType<typeof fetchTikTokOEmbed>> = null;
            try {
                oEmbed = await fetchTikTokOEmbed(rawUrl, abortController.signal);
            } catch (e: any) {
                if (e?.name === 'AbortError') {
                    return errorResponse('TIMEOUT', 'Resolver timed out', 503);
                }
                if (e?.code === 'UPSTREAM_RATE_LIMITED') {
                    return errorResponse('UPSTREAM_RATE_LIMITED', 'TikTok is busy — try again in a minute', 503);
                }
                return errorResponse('UPSTREAM_UNAVAILABLE', 'Could not reach TikTok — try again', 503);
            }

            if (oEmbed) {
                notePrefill = captionToNote(oEmbed.title);
                // Extract first line of caption as search query (restaurant name signal)
                const firstLine = oEmbed.title.split(/\n/)[0].trim();
                query = firstLine.length > 0 ? firstLine : oEmbed.title;

                // Build partial_source with only available fields (no explicit null — [L1])
                const partial: Omit<WishlistSourceTikTok, 'type' | 'url'> = {};
                if (oEmbed.thumbnail_url) partial.thumbnail_url = oEmbed.thumbnail_url;
                if (oEmbed.author_unique_id) partial.author_handle = oEmbed.author_unique_id;
                if (oEmbed.author_name) partial.author_name = oEmbed.author_name;
                if (oEmbed.embed_product_id) partial.embed_product_id = oEmbed.embed_product_id;
                partialSource = partial;
            }
            // oEmbed null → zero-candidate, query stays null
        }

        // ── Google Maps: use resolved URL for place_id extraction ────────────
        if (sourceType === 'google_maps') {
            // Google Maps URLs often contain the place name in the path
            const pathParts = parsedUrl.pathname.split('/');
            const placeIndex = pathParts.findIndex((p) => p === 'place' || p === 'Place');
            if (placeIndex >= 0 && pathParts[placeIndex + 1]) {
                query = decodeURIComponent(pathParts[placeIndex + 1]).replace(/\+/g, ' ');
            } else {
                // Try query params: ?q=, ?query=
                query = parsedUrl.searchParams.get('q') ?? parsedUrl.searchParams.get('query');
            }
        }

        // ── Web: unfurl <title> ───────────────────────────────────────────────
        if (sourceType === 'web') {
            // Non-fatal: if it fails we just have no query
            const title = await unfurlWebTitle(rawUrl, abortController.signal).catch(() => null);
            if (title) {
                // Strip common "- Restaurant Name | NYC" suffixes from page titles
                query = title.replace(/\s*[\|—\-]\s*.+$/, '').trim();
            }
        }

        // ── Places search ────────────────────────────────────────────────────
        if (!query) {
            return jsonResponse({
                data: {
                    source_type: sourceType,
                    best_query: null,
                    note_prefill: notePrefill,
                    candidates: [],
                    partial_source: partialSource,
                } satisfies ResolveUrlResponse,
            });
        }

        let placeCandidates: PlacesPayload[];
        try {
            placeCandidates = await callPlacesSearch(
                query,
                authHeader,
                supabaseUrl,
                supabaseAnonKey,
                abortController.signal,
            );
        } catch (e: any) {
            if (e?.name === 'AbortError') {
                return errorResponse('TIMEOUT', 'Resolver timed out', 503);
            }
            if (e?.code === 'PLACES_RATE_LIMITED') {
                return errorResponse('PLACES_RATE_LIMITED', 'Search is temporarily unavailable — try again', 503);
            }
            return errorResponse('UPSTREAM_UNAVAILABLE', 'Could not complete search — try again', 503);
        }

        if (placeCandidates.length === 0) {
            return jsonResponse({
                data: {
                    source_type: sourceType,
                    best_query: query,
                    note_prefill: notePrefill,
                    candidates: [],
                    partial_source: partialSource,
                } satisfies ResolveUrlResponse,
            });
        }

        // ── Map Google place_id → restaurant_id [ARCH-REVIEW-H2] ────────────
        const googlePlaceIds = placeCandidates.map((p) => p.id).filter(Boolean);

        const { data: restaurantRows } = await supabase
            .from('restaurants')
            .select('id, external_id')
            .in('external_id', googlePlaceIds);

        const placeIdToRestaurantId = new Map<string, string>();
        for (const row of (restaurantRows ?? [])) {
            if (row.external_id) placeIdToRestaurantId.set(row.external_id, row.id);
        }

        // ── Check already_wishlisted ─────────────────────────────────────────
        const knownRestaurantIds = [...placeIdToRestaurantId.values()];
        const wishlistedSet = new Set<string>();

        if (knownRestaurantIds.length > 0) {
            const { data: wishlistRows } = await supabase
                .from('wishlist_items')
                .select('restaurant_id')
                .eq('user_id', user.id)
                .in('restaurant_id', knownRestaurantIds);

            for (const row of (wishlistRows ?? [])) {
                if (row.restaurant_id) wishlistedSet.add(row.restaurant_id);
            }
        }

        // ── Build candidates ─────────────────────────────────────────────────
        const topN = placeCandidates.slice(0, 3);
        const candidates: ResolvedCandidate[] = topN.map((place, idx): ResolvedCandidate => {
            const restaurantId = placeIdToRestaurantId.get(place.id) ?? null;
            const alreadyWishlisted = restaurantId ? wishlistedSet.has(restaurantId) : false;

            // Determine confidence.
            // 'exact' is reserved for actual Google place_id round-trip
            // (where the URL contained a place_id parameter and we verified
            // the top result has the same id). Current implementation only
            // extracts place names from Maps URLs (no place_id parsing yet),
            // so we can't claim 'exact' — downgrade to 'high'/'low' below.
            // TICKET-053 followup: parse place_id from `?q=place_id:...` and
            // `!1s<PLACE_ID>` URL segments, then promote round-trip matches.
            let confidence: Confidence = 'low';
            if (idx === 0 && (place.googleRatingCount ?? 0) > 50) {
                confidence = 'high';
            }

            // Augment PlacesPayload with location subobject for wishlist.add compat
            const restaurant: PlacesPayload = {
                ...place,
                external_id: place.id,
                location: {
                    address: place.formattedAddress ?? undefined,
                    locality: place.city ?? undefined,
                    country: place.country ?? undefined,
                },
            };

            return {
                restaurant,
                confidence,
                google_place_id: place.id,
                restaurant_id: restaurantId,
                already_wishlisted: alreadyWishlisted,
            };
        });

        return jsonResponse({
            data: {
                source_type: sourceType,
                best_query: query,
                note_prefill: notePrefill,
                candidates,
                partial_source: partialSource,
            } satisfies ResolveUrlResponse,
        });

    } catch (e: any) {
        if (e?.name === 'AbortError') {
            return errorResponse('TIMEOUT', 'Resolver timed out', 503);
        }
        console.error('resolve-url error:', e);
        return errorResponse('INTERNAL', 'Internal server error', 500);
    } finally {
        clearTimeout(timeoutId);
    }
});
