/**
 * resolve-url edge function — TICKET-053 + TICKET-060
 *
 * TICKET-053: POST { url: string }
 * TICKET-060: POST { url?, image_path?, caption?, action?, job_id? }
 *   action='extract' (async path): fetches image from storage, extracts,
 *   PATCHes the import_jobs row, propagates restaurant to all destination rows.
 *
 * Extraction tiering (T-060):
 * 1. google_maps URL parse (no AI) — existing T-053 path
 * 2. If usable caption/title: extractFromText (~10× cheaper)
 * 3. If image present AND text insufficient: extractFromVision
 *
 * Ghost quarantine (H4/R3): low-confidence extractions write
 *   verification='unverified', created_by=<saver> — never deduped/shared.
 *
 * Cache (H1/H5/R13/B2): content-derived fields only in extraction_cache.
 *   already_wishlisted + restaurant_id recomputed per-request.
 *
 * Error mapping [M4] (T-053 paths unchanged):
 * - TikTok oEmbed 200 valid → success
 * - TikTok oEmbed 200 malformed/empty → zero-candidate
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
import {
    extractFromVision,
    extractFromText,
    type ExtractedCandidate,
} from '../_shared/visionExtract.ts';
import { hashImage, hashTextSource, HASH_VERSION } from '../_shared/contentHash.ts';

// ── Types ─────────────────────────────────────────────────────────────────────

type SourceType = 'tiktok' | 'google_maps' | 'web' | 'instagram' | 'screenshot' | 'vision';
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
    /** True when the URL is Instagram-walled; client shows "add a screenshot" nudge. */
    ig_nudge?: boolean;
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

/** Check if a URL is Instagram (login-walled) */
function isInstagramUrl(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return host === 'instagram.com' || host === 'www.instagram.com';
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
    if (host === 'instagram.com' || host === 'www.instagram.com') {
        return 'instagram';
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

// ── Vision helpers ────────────────────────────────────────────────────────────

/**
 * Read extraction_cache for a given content_hash (B2: service-role only).
 * Returns cached extracted fields or null on miss.
 */
async function readExtractionCache(
    supabase: any,
    contentHash: string,
): Promise<ExtractedCandidate | null> {
    const { data } = await supabase
        .from('extraction_cache')
        .select('extracted, hash_version')
        .eq('content_hash', contentHash)
        .maybeSingle();
    if (!data?.extracted) return null;
    const e = data.extracted as Record<string, unknown>;
    return {
        name: (e['name'] as string) ?? null,
        city: (e['city'] as string) ?? null,
        cuisine: (e['cuisine'] as string) ?? null,
        address: (e['address'] as string) ?? null,
        booking_url: (e['booking_url'] as string) ?? null,
        hours: (e['hours'] as string) ?? null,
        confidence: (['high', 'low', 'exact'].includes(e['confidence'] as string)
            ? e['confidence'] : 'low') as ExtractedCandidate['confidence'],
        google_place_id: (e['google_place_id'] as string) ?? null,
    };
}

/**
 * Write extraction result to cache (service-role only, content-derived fields only — H1/B2).
 * Never stores restaurant_id or already_wishlisted.
 */
async function writeExtractionCache(
    supabase: any,
    contentHash: string,
    sourceUrl: string | null,
    extracted: ExtractedCandidate,
    modelId: string,
): Promise<void> {
    await supabase
        .from('extraction_cache')
        .upsert({
            content_hash: contentHash,
            hash_version: HASH_VERSION,
            source_url: sourceUrl,
            extracted: {
                name: extracted.name,
                city: extracted.city,
                cuisine: extracted.cuisine,
                address: extracted.address,
                booking_url: extracted.booking_url,
                hours: extracted.hours,
                confidence: extracted.confidence,
                google_place_id: extracted.google_place_id,
            },
            model: modelId,
        }, { onConflict: 'content_hash' });
}

/**
 * Upsert a ghost (unverified) restaurant or verified restaurant from extracted data.
 * Low-confidence → unverified, owned by saver (H4/R3).
 * High-confidence + Places match → verified.
 */
async function upsertRestaurantFromExtracted(
    supabase: any,
    extracted: ExtractedCandidate,
    userId: string,
    supabaseUrl: string,
    supabaseAnonKey: string,
    authHeader: string,
    abortSignal: AbortSignal,
): Promise<{ restaurantId: string | null; confidence: ExtractedCandidate['confidence'] }> {
    if (!extracted.name) return { restaurantId: null, confidence: extracted.confidence };

    // If we have a google_place_id, try a Places lookup first (free/verified path)
    if (extracted.google_place_id) {
        try {
            const placeCandidates = await callPlacesSearch(
                extracted.name,
                authHeader,
                supabaseUrl,
                supabaseAnonKey,
                abortSignal,
            );
            if (placeCandidates.length > 0) {
                const top = placeCandidates[0];
                const { data: existing } = await supabase
                    .from('restaurants')
                    .select('id')
                    .eq('external_id', top.id)
                    .maybeSingle();
                if (existing) {
                    return { restaurantId: existing.id, confidence: 'high' };
                }
                // Upsert the verified restaurant
                const { data: upserted } = await supabase
                    .from('restaurants')
                    .upsert({
                        external_id: top.id,
                        name: top.name ?? extracted.name,
                        city: top.city ?? extracted.city,
                        country: top.country,
                        address: top.formattedAddress ?? extracted.address,
                        verification: 'verified',
                    }, { onConflict: 'external_id' })
                    .select('id')
                    .single();
                return { restaurantId: upserted?.id ?? null, confidence: 'high' };
            }
        } catch {
            // Fall through to ghost
        }
    }

    // Low-confidence → unverified ghost, owned per-save (H4/R3)
    if (extracted.confidence === 'low' || !extracted.name) {
        // Create an unverified ghost owned by this user
        const { data: ghost } = await supabase
            .from('restaurants')
            .insert({
                external_id: `ghost_${userId}_${Date.now()}`,
                name: extracted.name,
                city: extracted.city,
                address: extracted.address,
                verification: 'unverified',
                created_by: userId,
            })
            .select('id')
            .single();
        return { restaurantId: ghost?.id ?? null, confidence: 'low' };
    }

    // High-confidence but no Places match → try Places search by name
    try {
        const query = [extracted.name, extracted.city].filter(Boolean).join(', ');
        const placeCandidates = await callPlacesSearch(
            query, authHeader, supabaseUrl, supabaseAnonKey, abortSignal,
        );
        if (placeCandidates.length > 0) {
            const top = placeCandidates[0];
            const { data: existing } = await supabase
                .from('restaurants')
                .select('id')
                .eq('external_id', top.id)
                .maybeSingle();
            if (existing) return { restaurantId: existing.id, confidence: 'high' };
            const { data: upserted } = await supabase
                .from('restaurants')
                .upsert({
                    external_id: top.id,
                    name: top.name ?? extracted.name,
                    city: top.city ?? extracted.city,
                    address: top.formattedAddress ?? extracted.address,
                    verification: 'verified',
                }, { onConflict: 'external_id' })
                .select('id')
                .single();
            return { restaurantId: upserted?.id ?? null, confidence: 'high' };
        }
    } catch {
        // Fall through
    }

    // No Places match for high-confidence → still create unverified ghost (never-block)
    const { data: ghost } = await supabase
        .from('restaurants')
        .insert({
            external_id: `ghost_${userId}_${Date.now()}`,
            name: extracted.name,
            city: extracted.city,
            address: extracted.address,
            verification: 'unverified',
            created_by: userId,
        })
        .select('id')
        .single();
    return { restaurantId: ghost?.id ?? null, confidence: extracted.confidence };
}

/**
 * Handle inline vision extraction (not async — used when image_path is in body).
 * Returns candidates just like the URL-resolution path.
 */
async function handleVisionExtract(
    supabase: any,
    user: { id: string },
    imagePath: string,
    caption: string | null,
    supabaseUrl: string,
    supabaseAnonKey: string,
    authHeader: string,
): Promise<Response> {
    // Download the image from Storage
    const { data: imageData, error: imgError } = await supabase.storage
        .from('import-uploads')
        .download(imagePath);

    if (imgError || !imageData) {
        return errorResponse('IMAGE_NOT_FOUND', 'Could not read the uploaded image', 404);
    }

    const imageBytes = new Uint8Array(await (imageData as Blob).arrayBuffer());
    const imageHash = await hashImage(imageBytes);

    // Check cache first (H1/B2)
    let extracted = await readExtractionCache(supabase, imageHash);
    const modelId = Deno.env.get('EXTRACTION_MODEL') ?? 'claude-haiku-4-5-20251001';

    if (!extracted) {
        const imageBase64 = btoa(String.fromCharCode(...imageBytes));
        extracted = await extractFromVision(imageBase64, 'image/jpeg', caption ?? undefined);
        // Write content-derived fields only to cache (H1)
        await writeExtractionCache(supabase, imageHash, null, extracted, modelId).catch(() => null);
    }

    if (!extracted || !extracted.name) {
        return jsonResponse({
            data: {
                source_type: 'screenshot',
                best_query: null,
                note_prefill: caption ? captionToNote(caption) : '',
                candidates: [],
                partial_source: null,
                extracted_confidence: extracted?.confidence ?? 'low',
                needs_confirm: true,
            },
        });
    }

    // Try to resolve extracted name to a Places candidate
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 8000);

    const query = [extracted.name, extracted.city].filter(Boolean).join(', ');
    let placeCandidates: PlacesPayload[] = [];
    try {
        placeCandidates = await callPlacesSearch(
            query, authHeader, supabaseUrl, supabaseAnonKey, abortController.signal,
        );
    } catch { /* zero-candidate */ }

    const googlePlaceIds = placeCandidates.map((p) => p.id).filter(Boolean);
    const { data: restaurantRows } = googlePlaceIds.length > 0
        ? await supabase.from('restaurants').select('id, external_id')
            .in('external_id', googlePlaceIds)
            .eq('verification', 'verified')
        : { data: [] };

    const placeIdToRestaurantId = new Map<string, string>();
    for (const row of (restaurantRows ?? [])) {
        if (row.external_id) placeIdToRestaurantId.set(row.external_id, row.id);
    }

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

    const topN = placeCandidates.slice(0, 3);
    const candidates: ResolvedCandidate[] = topN.map((place, idx): ResolvedCandidate => {
        const restaurantId = placeIdToRestaurantId.get(place.id) ?? null;
        const alreadyWishlisted = restaurantId ? wishlistedSet.has(restaurantId) : false;
        const confidence: Confidence = idx === 0 && extracted!.confidence === 'high' ? 'high' : 'low';
        const restaurant: PlacesPayload = {
            ...place,
            external_id: place.id,
            location: {
                address: place.formattedAddress ?? undefined,
                locality: place.city ?? undefined,
                country: place.country ?? undefined,
            },
        };
        return { restaurant, confidence, google_place_id: place.id, restaurant_id: restaurantId, already_wishlisted: alreadyWishlisted };
    });

    // If no Places candidates, create a ghost candidate from extracted data
    if (candidates.length === 0 && extracted.name) {
        const ghostCandidate: ResolvedCandidate = {
            restaurant: {
                id: `ghost_pending`,
                name: extracted.name,
                formattedAddress: extracted.address,
                city: extracted.city,
                country: null,
                latitude: null,
                longitude: null,
                categories: [],
                cuisine: extracted.cuisine,
                googleRating: null,
                googleRatingCount: null,
                priceLevel: null,
                photoReference: null,
                website: null,
                link: null,
                external_id: `ghost_pending`,
                location: { address: extracted.address ?? undefined, locality: extracted.city ?? undefined },
            },
            confidence: extracted.confidence === 'high' ? 'high' : 'low',
            google_place_id: extracted.google_place_id ?? `ghost_pending`,
            restaurant_id: null,
            already_wishlisted: false,
        };
        candidates.push(ghostCandidate);
    }

    return jsonResponse({
        data: {
            source_type: 'screenshot' as SourceType,
            best_query: query || null,
            note_prefill: caption ? captionToNote(caption) : '',
            candidates,
            partial_source: null,
            extracted_confidence: extracted.confidence,
        },
    });
}

/**
 * Async extract action (R1 / CX-1 fix): called by table-shares after job creation.
 *
 * [CX-1/M-4 FIX] The internal call comes with the SERVICE-ROLE key as bearer.
 * auth.getUser(serviceKey) does NOT return the job owner — it returns a JWT sub
 * that is not the user, so `job.user_id !== user.id` always → 403 → jobs stuck pending.
 *
 * Fix: detect the internal call via a shared secret header (x-internal-secret)
 * and load the job owner from the DB, skipping the user-JWT ownership check.
 * The shared secret is INTERNAL_CALL_SECRET env var (service-role sets it on the
 * outbound fetch; resolve-url validates it on receipt of the extract action).
 * Fires: table-shares → resolve-url[action=extract]. Never user-facing.
 *
 * [M-3 FIX] Rate-limit check now runs at the top of this path.
 * [CX-5 FIX] Uses fn_complete_import_job SECURITY DEFINER for transactional completion.
 * [H-4 FIX] Computes real hashImage(bytes) for image saves, updates job.content_hash,
 * and keys the extraction_cache on it (not path hash).
 * [H-1 FIX] After wishlist save resolves, calls fn_detect_and_surface_float for
 * each Table the saver belongs to.
 */
async function handleAsyncExtract(
    supabase: any,
    isInternalCall: boolean,
    jobOwnerId: string,   // the saver's user_id — loaded from DB for internal calls
    jobId: string,
    supabaseUrl: string,
    supabaseAnonKey: string,
    authHeader: string,
): Promise<Response> {
    // [M-3] Rate-limit check: count against the job owner's extraction bucket
    const { data: rateRows } = await supabase.rpc(
        'check_and_increment_rate_limit',
        { p_user_id: jobOwnerId, p_bucket_key: 'resolve_content', p_max: 20, p_window_seconds: 3600 },
    ).catch(() => ({ data: null }));
    const rateRow = rateRows?.[0];
    if (rateRow && !rateRow.allowed) {
        // Never-block: land the save as needs_confirm, skip the model call (CODEX-M2 resolution)
        await supabase.rpc('fn_complete_import_job', {
            p_job_id: jobId,
            p_status: 'needs_confirm',
            p_restaurant_id: null,
        }).catch((e: unknown) => console.error('fn_complete_import_job (rate-limit) error:', e));
        return jsonResponse({ data: { job_id: jobId, status: 'needs_confirm', reason: 'rate_limited' } });
    }

    // Fetch the job
    const { data: job } = await supabase
        .from('import_jobs')
        .select('*')
        .eq('job_id', jobId)
        .maybeSingle();

    if (!job) {
        return errorResponse('JOB_NOT_FOUND', 'Import job not found', 404);
    }

    // [CX-1 FIX] For internal calls, ownership is validated by loading the job owner from DB
    // (jobOwnerId was set from job.user_id before this call). For user-facing calls, validate.
    if (!isInternalCall && job.user_id !== jobOwnerId) {
        return errorResponse('FORBIDDEN', 'Not your import job', 403);
    }

    if (job.status !== 'pending') {
        // Already processed — idempotent
        return jsonResponse({ data: { job_id: jobId, status: job.status } });
    }

    const source = job.source as Record<string, unknown> | null;
    const imagePath = (source?.['upload_path'] as string) ?? null;
    const captionText = (source?.['caption'] as string) ?? null;
    const sourceUrl = (source?.['source_url'] as string) ?? null;

    let extracted: ExtractedCandidate | null = null;
    const modelId = Deno.env.get('EXTRACTION_MODEL') ?? 'claude-haiku-4-5-20251001';

    // [H-4 FIX] For image saves, compute the real bytes-based hash instead of path hash.
    // The create_import placeholder was `path_${hash(path)}` which never dedupes images.
    // Download bytes first, compute hashImage, update job.content_hash, then check cache.
    let realImageHash: string | null = null;
    let imageBytes: Uint8Array | null = null;

    if (imagePath) {
        const { data: imageData } = await supabase.storage
            .from('import-uploads')
            .download(imagePath);
        if (imageData) {
            imageBytes = new Uint8Array(await (imageData as Blob).arrayBuffer());
            realImageHash = await hashImage(imageBytes);

            // Update the job's content_hash to the real bytes-hash so future dedup works
            if (realImageHash !== job.content_hash) {
                await supabase
                    .from('import_jobs')
                    .update({ content_hash: realImageHash })
                    .eq('job_id', jobId)
                    .catch(() => null);
                job.content_hash = realImageHash;
            }
        }
    }

    // Try cache first (using the real hash for images)
    const cacheKey = realImageHash ?? job.content_hash;
    if (cacheKey) {
        extracted = await readExtractionCache(supabase, cacheKey);
    }

    if (!extracted) {
        if (imageBytes) {
            // Vision path — use the already-downloaded bytes
            const imageBase64 = btoa(String.fromCharCode(...imageBytes));
            extracted = await extractFromVision(imageBase64, 'image/jpeg', captionText ?? undefined);
        } else if (captionText || sourceUrl) {
            // Text path (prefer text before vision when both present — L-1 partial)
            const textInput = [captionText, sourceUrl].filter(Boolean).join('\n');
            extracted = await extractFromText(textInput);
        }

        if (extracted && cacheKey) {
            await writeExtractionCache(supabase, cacheKey, sourceUrl, extracted, modelId).catch(() => null);
        }
    }

    if (!extracted) {
        // Fail soft — use transactional completion (CX-5)
        await supabase.rpc('fn_complete_import_job', {
            p_job_id: jobId,
            p_status: 'needs_confirm',
            p_restaurant_id: null,
        }).catch((e: unknown) => console.error('fn_complete_import_job (no-extract) error:', e));
        return jsonResponse({ data: { job_id: jobId, status: 'needs_confirm' } });
    }

    // Try to resolve a verified restaurant
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 8000);

    let restaurantId: string | null = null;
    let finalStatus: string = 'needs_confirm';

    if (extracted.name) {
        const result = await upsertRestaurantFromExtracted(
            supabase, extracted, job.user_id, supabaseUrl, supabaseAnonKey, authHeader, abortController.signal,
        );
        restaurantId = result.restaurantId;
        finalStatus = result.confidence === 'low' || !restaurantId ? 'needs_confirm' : 'resolved';
    }

    // [CX-5 FIX] Transactional job completion via SECURITY DEFINER RPC
    const { error: completeErr } = await supabase.rpc('fn_complete_import_job', {
        p_job_id: jobId,
        p_status: finalStatus,
        p_restaurant_id: restaurantId ?? null,
    });

    if (completeErr) {
        console.error('fn_complete_import_job error:', completeErr);
        // The save already landed — log but don't fail the response
    }

    // [H-1 FIX] After a successful resolved save, trigger float detection for each Table.
    // Only trigger if restaurant is verified (restaurantId is non-null and status=resolved).
    if (finalStatus === 'resolved' && restaurantId) {
        try {
            // Get the tables this job fanned into
            const { data: shareRows } = await supabase
                .from('table_shares')
                .select('table_id')
                .eq('job_id', jobId);

            const tableIds = [...new Set(
                (shareRows ?? []).map((s: { table_id: string }) => s.table_id).filter(Boolean)
            )];

            // Also check personal wishlist Tables via table_members
            const { data: memberRows } = await supabase
                .from('table_members')
                .select('table_id')
                .eq('member_id', job.user_id);

            const allTableIds = [...new Set([
                ...tableIds,
                ...(memberRows ?? []).map((m: { table_id: string }) => m.table_id),
            ])];

            for (const tableId of allTableIds) {
                await supabase.rpc('fn_detect_and_surface_float', {
                    p_table_id: tableId,
                    p_restaurant_id: restaurantId,
                    p_window_days: 14,
                    p_threshold: 3,
                }).catch(() => null); // Float detection is best-effort
            }
        } catch {
            // Float detection must never block or fail the save response
        }
    }

    return jsonResponse({
        data: {
            job_id: jobId,
            status: finalStatus,
            restaurant_id: restaurantId,
            extracted: {
                name: extracted.name,
                city: extracted.city,
                cuisine: extracted.cuisine,
                confidence: extracted.confidence,
            },
        },
    });
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
    let body: {
        url?: string;
        image_path?: string;
        caption?: string;
        action?: string;
        job_id?: string;
    };
    try {
        body = await req.json();
    } catch {
        return errorResponse('INVALID_BODY', 'Request body must be JSON', 400);
    }

    // ── Async extract action (TICKET-060 R1 / CX-1 fix) ─────────────────────
    // Called by table-shares after job creation to run extraction asynchronously.
    // [CX-1 FIX] Detect internal service-role calls via x-internal-secret header.
    // When called internally (service-role bearer), auth.getUser() does NOT return
    // the job owner — we load the owner from import_jobs.user_id instead.
    if (body?.action === 'extract' && body?.job_id) {
        const internalSecret = Deno.env.get('INTERNAL_CALL_SECRET') ?? '';
        const callerSecret = req.headers.get('x-internal-secret') ?? '';
        const isInternalCall = internalSecret.length > 0 && callerSecret === internalSecret;

        let jobOwnerId: string;
        if (isInternalCall) {
            // Load the job owner from DB — the user JWT is the service-role key
            const { data: jobRow } = await supabase
                .from('import_jobs')
                .select('user_id')
                .eq('job_id', body.job_id)
                .maybeSingle();
            if (!jobRow?.user_id) {
                return errorResponse('JOB_NOT_FOUND', 'Import job not found', 404);
            }
            jobOwnerId = jobRow.user_id as string;
        } else {
            // Normal user-facing call — use the authenticated user
            jobOwnerId = user.id;
        }

        return await handleAsyncExtract(
            supabase, isInternalCall, jobOwnerId,
            body.job_id, supabaseUrl, supabaseAnonKey, authHeader,
        );
    }

    const rawUrl = body?.url;
    // For vision/screenshot paths, url is optional (image_path may be supplied instead)
    const hasImage = typeof body?.image_path === 'string';
    if (!hasImage && (typeof rawUrl !== 'string' || !rawUrl)) {
        return errorResponse('INVALID_URL', 'url is required', 400);
    }

    // ── URL validation [M2] ───────────────────────────────────────────────────
    // For vision/screenshot paths, url validation is skipped (no url required)
    let parsedUrl: URL | null = null;
    let sourceType: SourceType = 'screenshot';

    if (rawUrl) {
        const urlResult = validateUrl(rawUrl);
        if (!urlResult.ok) {
            return errorResponse('INVALID_URL', `URL rejected: ${urlResult.reason}`, 400);
        }
        parsedUrl = urlResult.url;
    }

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
    if (parsedUrl) {
        sourceType = detectSourceType(parsedUrl);
    }

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
                oEmbed = await fetchTikTokOEmbed(rawUrl!, abortController.signal);
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
        if (sourceType === 'google_maps' && parsedUrl) {
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
            const title = await unfurlWebTitle(rawUrl!, abortController.signal).catch(() => null);
            if (title) {
                // Strip common "- Restaurant Name | NYC" suffixes from page titles
                query = title.replace(/\s*[\|—\-]\s*.+$/, '').trim();
            }
        }

        // ── Instagram: login-walled — nudge screenshot, best-effort text-LLM ─
        if (sourceType === 'instagram') {
            // If caption text rode along (future share-ext), run text extraction
            const caption = body?.caption?.trim();
            if (caption) {
                notePrefill = captionToNote(caption);
                query = caption.split(/\n/)[0].trim() || caption;
            }
            // Always return ig_nudge=true so client can show "add a screenshot" prompt
            clearTimeout(timeoutId);
            return jsonResponse({
                data: {
                    source_type: 'instagram',
                    best_query: query,
                    note_prefill: notePrefill,
                    candidates: [],
                    partial_source: null,
                    ig_nudge: true,
                } satisfies ResolveUrlResponse,
            });
        }

        // ── Vision/screenshot path (TICKET-060): image_path supplied ─────────
        if (hasImage && body?.image_path) {
            clearTimeout(timeoutId);
            return handleVisionExtract(
                supabase, user, body.image_path, body?.caption ?? null,
                supabaseUrl, supabaseAnonKey, authHeader,
            );
        }

        // ── Places search ────────────────────────────────────────────────────
        if (!query) {
            clearTimeout(timeoutId);
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
            clearTimeout(timeoutId);
            if (e?.name === 'AbortError') {
                return errorResponse('TIMEOUT', 'Resolver timed out', 503);
            }
            if (e?.code === 'PLACES_RATE_LIMITED') {
                return errorResponse('PLACES_RATE_LIMITED', 'Search is temporarily unavailable — try again', 503);
            }
            return errorResponse('UPSTREAM_UNAVAILABLE', 'Could not complete search — try again', 503);
        }

        clearTimeout(timeoutId);

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
        clearTimeout(timeoutId);
        if (e?.name === 'AbortError') {
            return errorResponse('TIMEOUT', 'Resolver timed out', 503);
        }
        console.error('resolve-url error:', e);
        return errorResponse('INTERNAL', 'Internal server error', 500);
    }
});
