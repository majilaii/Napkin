/**
 * resolve-url edge function — TICKET-053 + TICKET-060 + TICKET-063
 *
 * TICKET-063 pipeline (synchronous URL path):
 *   cache read → text-tier extract → vision-tier (conditional) → merge/dedupe/rank/cap-6
 *   → cache WRITE → per-candidate Places resolution (parallel ≤6) → wishlist dedupe → respond
 *
 * TICKET-063 save_spots action (ARCH-REVIEW-2 #1 — lives here, NOT in table-shares):
 *   POST { action: 'save_spots', candidates: [...], import_nonce, table_id? }
 *   Loops ticked spots (≤6), calls fn_save_import_spot per spot, returns per-spot status.
 *
 * Vision trigger (ARCH-REVIEW-2 #6):
 *   Run thumbnail vision when text-tier yields ZERO exact|high candidates,
 *   OR when a listicle marker is detected and text-tier count < min(list_count, 6).
 *   Hero path (single confident text candidate) never pays for vision.
 *
 * 8s budget (ARCH-REVIEW-2 #6):
 *   oEmbed ≤2.5s · text-LLM ≤2.5s · thumbnail fetch ≤1.5s · resize ≤0.5s
 *   · vision ≤2.5s · Places ≤2.5s (parallel Promise.all ≤6).
 *   After candidates exist, budget exhaustion → degrade gracefully (never hard-fail).
 *
 * Merge/dedupe/rank (ARCH-REVIEW-2 #7):
 *   pre-Places fuzzy key = normalize(name)+city (containment fold)
 *   post-Places canonical key = google_place_id ?? restaurant_id
 *   rank = (confidence desc, source-agreement desc, list-ordinal asc)
 *   text-tier wins on field conflict; vision fills nulls.
 *
 * candidate_id (ARCH-REVIEW-2 #10):
 *   sha256(content_hash + ':' + normalized_name + ':' + index).slice(0,16)
 *
 * ARCH-REVIEW-2 #11: resize failure → vision tier SKIPPED (raw bytes never sent).
 *
 * Backward compat: candidates[] shape + ordering preserved; candidates[0] = best.
 *   city_inferred + candidate_id are additive; old client ignores them.
 *
 * Previous paths unchanged:
 *   action=extract (async screenshot, internal-only)
 *   image_path (inline vision, handleVisionExtract)
 *   TikTok/Maps/web/IG/screenshot source types
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
    extractFromTextMulti,
    extractFromVisionMulti,
    type ExtractedCandidate,
} from '../_shared/visionExtract.ts';
import { hashImage, hashTextSource, HASH_VERSION } from '../_shared/contentHash.ts';
import { detectListMarker } from '../_shared/listicle.ts';
import { resizeImageToLimit } from '../_shared/imageResize.ts';
import { upsertRestaurant } from '../_shared/restaurant.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Constant-time byte comparison — prevents timing oracle on the internal secret. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a[i] ^ b[i];
    }
    return diff === 0;
}

// ── Deadline helper (ARCH-REVIEW-2 #6) ───────────────────────────────────────

class Deadline {
    private readonly deadline: number;
    private readonly controller: AbortController;

    constructor(budgetMs: number) {
        this.deadline = Date.now() + budgetMs;
        this.controller = new AbortController();
        // Auto-abort when budget expires
        const remaining = this.remaining();
        if (remaining <= 0) {
            this.controller.abort();
        } else {
            setTimeout(() => this.controller.abort(), remaining);
        }
    }

    get signal(): AbortSignal { return this.controller.signal; }

    remaining(): number {
        return Math.max(0, this.deadline - Date.now());
    }

    /** Returns an AbortSignal that fires after `ms` or when the global budget expires. */
    stageSignal(ms: number): AbortSignal {
        const stageController = new AbortController();
        const stageTimeout = setTimeout(() => stageController.abort(), Math.min(ms, this.remaining()));
        this.signal.addEventListener('abort', () => {
            clearTimeout(stageTimeout);
            stageController.abort();
        }, { once: true });
        return stageController.signal;
    }

    get aborted(): boolean { return this.signal.aborted; }
}

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
    /** null for unresolved ghost candidates (no confirmed Places id). */
    external_id: string | null;
    location?: {
        address?: string;
        locality?: string;
        country?: string;
    };
}

interface ResolvedCandidate {
    candidate_id: string;
    restaurant: PlacesPayload;
    confidence: Confidence;
    /** null for unresolved ghost candidates (no confirmed Places id). */
    google_place_id: string | null;
    restaurant_id: string | null;
    already_wishlisted: boolean;
    /** TICKET-063: true when city was inferred from context, not stated. */
    city_inferred: boolean;
}

interface ResolveUrlResponse {
    source_type: SourceType;
    best_query: string | null;
    note_prefill: string;
    candidates: ResolvedCandidate[];
    partial_source: Omit<WishlistSourceTikTok, 'type' | 'url'> | null;
    /** True when the URL is Instagram-walled; client shows screenshot nudge. */
    ig_nudge?: boolean;
    /** TICKET-063: advertised list count from the listicle heuristic (≤6). */
    list_count?: number | null;
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

// ── Text normalization for dedupe ─────────────────────────────────────────────

/** Normalize a name for fuzzy pre-Places dedup. */
function normalizeName(name: string | null | undefined): string {
    if (!name) return '';
    // Lowercase, strip diacritics, strip punctuation, collapse whitespace
    return name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Fuzzy dedup key: normalized_name + '|' + normalized_city.
 * Containment fold: if one name contains the other, use the shorter one as the key.
 */
function fuzzyKey(name: string | null, city: string | null): string {
    const n = normalizeName(name);
    const c = normalizeName(city);
    return `${n}|${c}`;
}

// ── Candidate dedup + merge + rank ────────────────────────────────────────────

interface StagedCandidate {
    extracted: ExtractedCandidate;
    /** 0 = text-tier; 1 = vision-tier */
    tier: 0 | 1;
    /** Original position within tier (for ordinal sort) */
    ordinal: number;
    /** True if seen in both tiers (source-agreement) */
    inBothTiers: boolean;
}

/**
 * Two-stage dedupe + rank:
 *   Stage 1 (pre-Places): fuzzy key = normalize(name) + city
 *     - containment fold: "Berenjak Soho" + "Berenjak" → keep whichever has higher confidence / lower ordinal
 *   Stage 2 (post-Places): by google_place_id
 *
 * Rank tuple: (confidence desc, source-agreement desc, list ordinal asc)
 * Field conflicts: text-tier wins; vision fills nulls.
 * Cap 6 (silent tail drop).
 */
function dedupeAndRank(
    textCandidates: ExtractedCandidate[],
    visionCandidates: ExtractedCandidate[],
): StagedCandidate[] {
    const staged: StagedCandidate[] = [];
    const fuzzySet = new Map<string, number>(); // fuzzyKey → staged index

    const addOrMerge = (ext: ExtractedCandidate, tier: 0 | 1, ordinal: number) => {
        const fk = fuzzyKey(ext.name, ext.city);

        // Containment fold: check if any existing key contains / is contained by this name
        let existingIdx: number | undefined;
        const normN = normalizeName(ext.name);
        for (const [existingKey, idx] of fuzzySet.entries()) {
            const [existingName] = existingKey.split('|');
            if (normN && existingName && (normN.includes(existingName) || existingName.includes(normN))) {
                existingIdx = idx;
                break;
            }
        }

        if (existingIdx !== undefined) {
            // Merge: text-tier wins for fields; mark inBothTiers
            const existing = staged[existingIdx];
            if (tier === 0) {
                // This is the text-tier copy — it wins
                existing.inBothTiers = true;
                existing.extracted = mergeExtracted(ext, existing.extracted); // text wins
                existing.tier = 0;
            } else {
                // Vision-tier — fill nulls only
                existing.inBothTiers = true;
                existing.extracted = mergeExtracted(existing.extracted, ext); // existing wins
            }
            return;
        }

        // Check exact fuzzy key match
        if (fuzzySet.has(fk)) {
            const idx = fuzzySet.get(fk)!;
            const existing = staged[idx];
            if (tier === 0) {
                existing.inBothTiers = true;
                existing.extracted = mergeExtracted(ext, existing.extracted);
                existing.tier = 0;
            } else {
                existing.inBothTiers = true;
                existing.extracted = mergeExtracted(existing.extracted, ext);
            }
            return;
        }

        // New candidate
        fuzzySet.set(fk, staged.length);
        staged.push({ extracted: ext, tier, ordinal, inBothTiers: false });
    };

    textCandidates.forEach((c, i) => addOrMerge(c, 0, i));
    visionCandidates.forEach((c, i) => addOrMerge(c, 1, i + textCandidates.length));

    // Rank: confidence desc, inBothTiers desc, ordinal asc
    const confidenceOrder = { high: 0, exact: 0, low: 1 };
    staged.sort((a, b) => {
        const ca = confidenceOrder[a.extracted.confidence] ?? 1;
        const cb = confidenceOrder[b.extracted.confidence] ?? 1;
        if (ca !== cb) return ca - cb;
        if (a.inBothTiers !== b.inBothTiers) return a.inBothTiers ? -1 : 1;
        return a.ordinal - b.ordinal;
    });

    return staged.slice(0, 6); // cap 6
}

/** Merge two ExtractedCandidates: `primary` wins on non-null fields; `secondary` fills nulls. */
function mergeExtracted(primary: ExtractedCandidate, secondary: ExtractedCandidate): ExtractedCandidate {
    return {
        name: primary.name ?? secondary.name,
        city: primary.city ?? secondary.city,
        city_inferred: primary.city !== null ? primary.city_inferred : secondary.city_inferred,
        cuisine: primary.cuisine ?? secondary.cuisine,
        address: primary.address ?? secondary.address,
        booking_url: primary.booking_url ?? secondary.booking_url,
        hours: primary.hours ?? secondary.hours,
        confidence: primary.confidence === 'high' || primary.confidence === 'exact'
            ? primary.confidence
            : secondary.confidence,
        google_place_id: primary.google_place_id ?? secondary.google_place_id,
    };
}

// ── candidate_id (ARCH-REVIEW-2 #10) ─────────────────────────────────────────

async function computeCandidateId(
    contentHash: string,
    normalizedName: string,
    index: number,
): Promise<string> {
    const raw = `${contentHash}:${normalizedName}:${index}`;
    const bytes = new TextEncoder().encode(raw);
    const buf = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
    const hex = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    return hex.slice(0, 16);
}

// ── Extraction cache (array shape + HASH_VERSION filter) ─────────────────────

/**
 * Read extraction cache.
 * TICKET-063: filters by HASH_VERSION=2 and reads candidates as an array.
 * Old v1 single-object rows are a guaranteed miss (HASH_VERSION mismatch).
 */
async function readExtractionCache(
    supabase: any,
    contentHash: string,
): Promise<ExtractedCandidate[] | null> {
    const { data } = await supabase
        .from('extraction_cache')
        .select('extracted, hash_version')
        .eq('content_hash', contentHash)
        .eq('hash_version', HASH_VERSION)
        .maybeSingle();

    if (!data?.extracted) return null;

    const e = data.extracted as Record<string, unknown>;

    // TICKET-063: expect array shape { candidates: [...] }
    if (Array.isArray(e['candidates'])) {
        const arr = e['candidates'] as unknown[];
        const parsed = arr.map((item: unknown): ExtractedCandidate => {
            const p = (item && typeof item === 'object' && !Array.isArray(item))
                ? item as Record<string, unknown>
                : {};
            const conf = p['confidence'];
            return {
                name: typeof p['name'] === 'string' ? p['name'] || null : null,
                city: typeof p['city'] === 'string' ? p['city'] || null : null,
                city_inferred: p['city_inferred'] === true,
                cuisine: typeof p['cuisine'] === 'string' ? p['cuisine'] || null : null,
                address: typeof p['address'] === 'string' ? p['address'] || null : null,
                booking_url: typeof p['booking_url'] === 'string' ? p['booking_url'] || null : null,
                hours: typeof p['hours'] === 'string' ? p['hours'] || null : null,
                confidence: (['high', 'low', 'exact'].includes(conf as string) ? conf : 'low') as any,
                google_place_id: typeof p['google_place_id'] === 'string' ? p['google_place_id'] || null : null,
            };
        });
        return parsed.filter((c) => c.name !== null);
    }

    // Old single-object shape (shouldn't happen after HASH_VERSION filter, but guard anyway)
    return null;
}

/**
 * Write extraction result array to cache.
 * Stores candidates array inside { candidates: [...] } ONLY content-derived fields.
 * Never stores restaurant_id, already_wishlisted, client_nonce, notes, or resume state.
 */
async function writeExtractionCache(
    supabase: any,
    contentHash: string,
    sourceUrl: string | null,
    candidates: ExtractedCandidate[],
    modelId: string,
): Promise<void> {
    await supabase
        .from('extraction_cache')
        .upsert({
            content_hash: contentHash,
            hash_version: HASH_VERSION,
            source_url: sourceUrl,
            extracted: {
                candidates: candidates.map((c) => ({
                    name: c.name,
                    city: c.city,
                    city_inferred: c.city_inferred,
                    cuisine: c.cuisine,
                    address: c.address,
                    booking_url: c.booking_url,
                    hours: c.hours,
                    confidence: c.confidence,
                    google_place_id: c.google_place_id,
                })),
            },
            model: modelId,
        }, { onConflict: 'content_hash' });
}

// ── TikTok oEmbed ─────────────────────────────────────────────────────────────

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

    if (res.status === 400 || res.status === 404) return null;
    if (res.status === 429) throw { code: 'UPSTREAM_RATE_LIMITED', retryable: true };
    if (res.status >= 500) throw { code: 'UPSTREAM_UNAVAILABLE', retryable: true };
    if (!res.ok) return null;

    let json: any;
    try { json = await res.json(); } catch { return null; }
    if (!json || typeof json.title !== 'string') return null;

    return {
        title: json.title,
        author_unique_id: json.author_unique_id ?? undefined,
        author_name: json.author_name ?? undefined,
        thumbnail_url: json.thumbnail_url ?? undefined,
        embed_product_id: json.embed_product_id ?? undefined,
    };
}

// ── Thumbnail fetch + resize (TICKET-063) ─────────────────────────────────────

/**
 * Fetch a thumbnail image URL, validate content-type + size, and downscale.
 * Returns base64 + mimeType on success; null on any failure (fail-soft).
 *
 * ARCH-REVIEW-2 #11: if resize fails, return null — caller MUST skip vision.
 * Raw bytes are never sent.
 *
 * Constraints:
 *   - content-type must start with "image/"
 *   - raw size cap 8MB
 *   - single attempt (no retry)
 */
async function fetchAndResizeThumbnail(
    thumbnailUrl: string,
    signal: AbortSignal,
): Promise<{ base64: string; mimeType: string } | null> {
    try {
        const res = await fetch(thumbnailUrl, { signal });
        if (!res.ok) return null;

        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.startsWith('image/')) return null;

        const blob = await res.blob();
        if (blob.size > 8 * 1024 * 1024) return null; // 8MB cap

        const bytes = new Uint8Array(await blob.arrayBuffer());

        // ARCH-REVIEW-2 #11: resize failure → return null (vision tier skipped)
        const resized = await resizeImageToLimit(bytes, signal);
        if (!resized) return null;

        const base64 = btoa(String.fromCharCode(...resized.data));
        return { base64, mimeType: resized.mimeType };
    } catch {
        return null;
    }
}

// ── Web unfurl ────────────────────────────────────────────────────────────────

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

// ── Places search ─────────────────────────────────────────────────────────────

async function callPlacesSearch(
    query: string,
    authHeader: string,
    supabaseUrl: string,
    supabaseAnonKey: string,
    signal: AbortSignal,
    internalSecret?: string,
): Promise<PlacesPayload[]> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: authHeader,
        apikey: supabaseAnonKey,
    };
    if (internalSecret) {
        headers['x-internal-secret'] = internalSecret;
    }

    let res: Response;
    try {
        res = await fetch(`${supabaseUrl}/functions/v1/places-search`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query, limit: 3 }),
            signal,
        });
    } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e;
        throw { code: 'UPSTREAM_UNAVAILABLE', retryable: true };
    }

    if (res.status === 429) throw { code: 'PLACES_RATE_LIMITED', retryable: true };
    if (res.status >= 500) throw { code: 'UPSTREAM_UNAVAILABLE', retryable: true };
    if (!res.ok) throw { code: 'PLACES_AUTH_FAIL', status: res.status, retryable: false };

    let body: any;
    try { body = await res.json(); } catch { return []; }

    const candidates = body?.data?.candidates ?? body?.data ?? body?.candidates ?? [];
    return Array.isArray(candidates) ? candidates : [];
}

// ── Exported decision helpers (TICKET-063 fix-pass-1, testable) ──────────────
// Implementations live in _helpers.ts (no serve() call) so test files can
// import them without triggering the HTTP server.
import { isGhostExternalId, buildGhostExternalId, filterUnauthorizedTableIds, mapVerifiedRestaurantIds } from './_helpers.ts';
export { isGhostExternalId, buildGhostExternalId, filterUnauthorizedTableIds };

// ── Places Details by place_id (FIX #5: never text-search for place_id candidates) ──

/**
 * Call places-search with a `place_id` (Details endpoint) instead of a text query.
 * ARCH-REVIEW-2 #8: on DB miss for a google_place_id, call Details — NEVER text search.
 * Returns null on any failure (fail-soft).
 */
async function callPlacesDetails(
    placeId: string,
    authHeader: string,
    supabaseUrl: string,
    supabaseAnonKey: string,
    signal: AbortSignal,
): Promise<PlacesPayload | null> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: authHeader,
        apikey: supabaseAnonKey,
    };
    let res: Response;
    try {
        res = await fetch(`${supabaseUrl}/functions/v1/places-search`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ place_id: placeId }),
            signal,
        });
    } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e;
        return null;
    }
    if (!res.ok) return null;
    let body: any;
    try { body = await res.json(); } catch { return null; }
    const candidates = body?.data?.candidates ?? body?.data ?? body?.candidates ?? [];
    const arr = Array.isArray(candidates) ? candidates : [];
    return arr[0] ?? null;
}

// ── Per-candidate Places resolution (ARCH-REVIEW-2 #8) ───────────────────────

/**
 * Resolve a single extracted candidate to a Places result.
 * - If candidate has google_place_id: DB lookup by external_id first,
 *   then Places Details by id on miss (NEVER text-search for a place_id candidate).
 * - Otherwise: text search by name+city.
 * - Never-block: returns null on any failure.
 */
async function resolveCandidateToPlace(
    supabase: any,
    candidate: ExtractedCandidate,
    authHeader: string,
    supabaseUrl: string,
    supabaseAnonKey: string,
    signal: AbortSignal,
): Promise<PlacesPayload | null> {
    if (!candidate.name) return null;

    // ARCH-REVIEW-2 #8: if google_place_id → DB lookup first, else Places Details.
    // FIX #5: NEVER fall through to text search for a place_id candidate.
    if (candidate.google_place_id) {
        const { data: existing } = await supabase
            .from('restaurants')
            .select('id, external_id, name, city, address, verification')
            .eq('external_id', candidate.google_place_id)
            .maybeSingle();
        if (existing) {
            if (existing.verification === 'verified') {
                // Verified row: return cached DB payload immediately.
                return buildPlacesPayloadFromDb(existing, candidate);
            }
            // Stale unverified row — attempt a Places Details refresh.
            // On success, the candidate flows the external_id save path which upserts
            // the row to verified with full metadata (item 1, fix-pass-2).
            // On failure, degrade gracefully to what we have in DB (item 2's quarantine
            // keeps unverified rows out of Table shares regardless).
            try {
                return await callPlacesDetails(
                    candidate.google_place_id,
                    authHeader,
                    supabaseUrl,
                    supabaseAnonKey,
                    signal,
                );
            } catch {
                return buildPlacesPayloadFromDb(existing, candidate);
            }
        }
        // DB miss → Places Details by id (binding #8 / fix #5: never text-search here).
        try {
            return await callPlacesDetails(
                candidate.google_place_id,
                authHeader,
                supabaseUrl,
                supabaseAnonKey,
                signal,
            );
        } catch {
            // Fail-soft: unresolved → ghost candidate
            return null;
        }
    }

    // No google_place_id → text search by name + city (candidates without a known place_id)
    const query = [candidate.name, candidate.city].filter(Boolean).join(', ');
    try {
        const results = await callPlacesSearch(
            query, authHeader, supabaseUrl, supabaseAnonKey, signal,
        );
        return results[0] ?? null;
    } catch {
        return null;
    }
}

function buildPlacesPayloadFromDb(row: any, fallback: ExtractedCandidate): PlacesPayload {
    return {
        id: row.external_id ?? '',
        name: row.name ?? fallback.name,
        formattedAddress: row.address ?? fallback.address,
        city: row.city ?? fallback.city,
        country: null,
        latitude: null,
        longitude: null,
        categories: [],
        cuisine: fallback.cuisine,
        googleRating: null,
        googleRatingCount: null,
        priceLevel: null,
        photoReference: null,
        website: null,
        link: null,
        external_id: row.external_id ?? '',
        location: {
            address: row.address ?? undefined,
            locality: row.city ?? undefined,
        },
    };
}

// ── Vision helpers (original single-candidate paths, unchanged) ───────────────

/**
 * Read extraction_cache for a given content_hash (B2: service-role only).
 * Legacy single-candidate version for handleAsyncExtract.
 * TICKET-063: now delegates to readExtractionCache and returns [0].
 */
async function readExtractionCacheSingle(
    supabase: any,
    contentHash: string,
): Promise<ExtractedCandidate | null> {
    const arr = await readExtractionCache(supabase, contentHash);
    return arr?.[0] ?? null;
}

async function writeExtractionCacheSingle(
    supabase: any,
    contentHash: string,
    sourceUrl: string | null,
    extracted: ExtractedCandidate,
    modelId: string,
): Promise<void> {
    await writeExtractionCache(supabase, contentHash, sourceUrl, [extracted], modelId);
}

/**
 * Handle inline vision extraction (not async — used when image_path is in body).
 * TICKET-063: upgrades to multi-candidate extractor; returns first as before.
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
    const { data: imageData, error: imgError } = await supabase.storage
        .from('import-uploads')
        .download(imagePath);

    if (imgError || !imageData) {
        return errorResponse('IMAGE_NOT_FOUND', 'Could not read the uploaded image', 404);
    }

    const imageBytes = new Uint8Array(await (imageData as Blob).arrayBuffer());
    const imageHash = await hashImage(imageBytes);

    let extractedArr = await readExtractionCache(supabase, imageHash);
    const modelId = Deno.env.get('EXTRACTION_MODEL') ?? 'claude-haiku-4-5-20251001';

    if (!extractedArr) {
        const imageBase64 = btoa(String.fromCharCode(...imageBytes));
        extractedArr = await extractFromVisionMulti(imageBase64, 'image/jpeg', caption ?? undefined);
        if (extractedArr.length > 0) {
            await writeExtractionCache(supabase, imageHash, null, extractedArr, modelId).catch(() => null);
        }
    }

    const extracted = extractedArr?.[0] ?? null;

    if (!extracted || !extracted.name) {
        return jsonResponse({
            data: {
                source_type: 'screenshot',
                best_query: null,
                note_prefill: caption ? captionToNote(caption) : '',
                candidates: [],
                partial_source: null,
                extracted_confidence: 'low',
                needs_confirm: true,
            },
        });
    }

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
    const candidates: ResolvedCandidate[] = await Promise.all(
        topN.map(async (place, idx): Promise<ResolvedCandidate> => {
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
            const candidateId = await computeCandidateId(imageHash, normalizeName(place.name), idx);
            return {
                candidate_id: candidateId,
                restaurant,
                confidence,
                google_place_id: place.id,
                restaurant_id: restaurantId,
                already_wishlisted: alreadyWishlisted,
                city_inferred: extracted!.city_inferred,
            };
        })
    );

    if (candidates.length === 0 && extracted.name) {
        // FIX #2: ghost candidates use google_place_id=null and external_id=null.
        // The sentinel 'ghost_pending' caused cross-user row collapse in fn_save_import_spot.
        // The RPC mints a stable 'ghost_{user}_{nonce}' external_id at save time.
        const candidateId = await computeCandidateId(imageHash, normalizeName(extracted.name), 0);
        const ghostCandidate: ResolvedCandidate = {
            candidate_id: candidateId,
            restaurant: {
                id: '',
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
                external_id: null,
                location: { address: extracted.address ?? undefined, locality: extracted.city ?? undefined },
            },
            confidence: extracted.confidence === 'high' ? 'high' : 'low',
            google_place_id: extracted.google_place_id ?? null,
            restaurant_id: null,
            already_wishlisted: false,
            city_inferred: extracted.city_inferred,
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
 * Async extract action — unchanged from TICKET-060 (internal-only).
 * TICKET-063: upgrades to multi extractor internally; takes [0] for single-candidate path.
 */
async function handleAsyncExtract(
    supabase: any,
    isInternalCall: boolean,
    jobOwnerId: string,
    jobId: string,
    supabaseUrl: string,
    supabaseAnonKey: string,
    authHeader: string,
    internalSecret?: string,
): Promise<Response> {
    const { data: job } = await supabase
        .from('import_jobs')
        .select('*')
        .eq('job_id', jobId)
        .maybeSingle();

    if (!job) return errorResponse('JOB_NOT_FOUND', 'Import job not found', 404);

    if (!isInternalCall && job.user_id !== jobOwnerId) {
        await supabase.rpc('fn_complete_import_job', {
            p_job_id: jobId, p_status: 'needs_confirm', p_restaurant_id: null,
        }).catch(() => null);
        return errorResponse('FORBIDDEN', 'Not your import job', 403);
    }

    if (job.status !== 'pending') {
        return jsonResponse({ data: { job_id: jobId, status: job.status } });
    }

    const { data: rateRows } = await supabase.rpc(
        'check_and_increment_rate_limit',
        { p_user_id: jobOwnerId, p_bucket_key: 'resolve_content', p_max: 20, p_window_seconds: 3600 },
    ).catch(() => ({ data: null }));
    const rateRow = rateRows?.[0];
    if (rateRow && !rateRow.allowed) {
        await supabase.rpc('fn_complete_import_job', {
            p_job_id: jobId, p_status: 'needs_confirm', p_restaurant_id: null,
        }).catch(() => null);
        return jsonResponse({ data: { job_id: jobId, status: 'needs_confirm', reason: 'rate_limited' } });
    }

    const source = job.source as Record<string, unknown> | null;
    const imagePath = (source?.['upload_path'] as string) ?? null;
    const captionText = (source?.['caption'] as string) ?? null;
    const sourceUrl = (source?.['source_url'] as string) ?? null;

    if (imagePath) {
        const firstSegment = imagePath.split('/')[0];
        if (firstSegment !== jobOwnerId) {
            await supabase.rpc('fn_complete_import_job', {
                p_job_id: jobId, p_status: 'needs_confirm', p_restaurant_id: null,
            }).catch(() => null);
            return errorResponse('FORBIDDEN', 'image_path does not belong to job owner', 403);
        }
    }

    // Single-candidate for async path (unchanged behavior)
    let extracted: ExtractedCandidate | null = null;
    const modelId = Deno.env.get('EXTRACTION_MODEL') ?? 'claude-haiku-4-5-20251001';

    let realImageHash: string | null = null;
    let imageBytes: Uint8Array | null = null;

    if (imagePath) {
        const { data: imageData } = await supabase.storage
            .from('import-uploads')
            .download(imagePath);
        if (imageData) {
            imageBytes = new Uint8Array(await (imageData as Blob).arrayBuffer());
            realImageHash = await hashImage(imageBytes);
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

    const cacheKey = realImageHash ?? job.content_hash;
    if (cacheKey) {
        extracted = await readExtractionCacheSingle(supabase, cacheKey);
    }

    if (!extracted) {
        if (imageBytes) {
            const imageBase64 = btoa(String.fromCharCode(...imageBytes));
            extracted = await extractFromVision(imageBase64, 'image/jpeg', captionText ?? undefined);
        } else if (captionText || sourceUrl) {
            const textInput = [captionText, sourceUrl].filter(Boolean).join('\n');
            extracted = await extractFromText(textInput);
        }

        if (extracted && cacheKey) {
            await writeExtractionCacheSingle(supabase, cacheKey, sourceUrl, extracted, modelId).catch(() => null);
        }
    }

    if (!extracted) {
        await supabase.rpc('fn_complete_import_job', {
            p_job_id: jobId, p_status: 'needs_confirm', p_restaurant_id: null,
        }).catch(() => null);
        return jsonResponse({ data: { job_id: jobId, status: 'needs_confirm' } });
    }

    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 8000);

    let restaurantId: string | null = null;
    let finalStatus: string = 'needs_confirm';

    if (extracted.name) {
        try {
            const result = await upsertRestaurantFromExtracted(
                supabase, extracted, job.user_id, supabaseUrl, supabaseAnonKey,
                authHeader, abortController.signal, internalSecret,
            );
            restaurantId = result.restaurantId;
            finalStatus = result.confidence === 'low' || !restaurantId ? 'needs_confirm' : 'resolved';
        } catch (e: any) {
            console.error('upsertRestaurantFromExtracted error (→ needs_confirm):', e?.code ?? e);
            finalStatus = 'needs_confirm';
            restaurantId = null;
        }
    }

    const { error: completeErr } = await supabase.rpc('fn_complete_import_job', {
        p_job_id: jobId,
        p_status: finalStatus,
        p_restaurant_id: restaurantId ?? null,
    });

    if (completeErr) {
        console.error('fn_complete_import_job error:', completeErr);
    }

    if (finalStatus === 'resolved' && restaurantId) {
        try {
            const { data: shareRows } = await supabase
                .from('table_shares')
                .select('table_id')
                .eq('job_id', jobId);

            const tableIds = [...new Set(
                (shareRows ?? []).map((s: { table_id: string }) => s.table_id).filter(Boolean)
            )];

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
                }).catch(() => null);
            }
        } catch {
            // Float detection must never block
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

// ── upsertRestaurantFromExtracted (unchanged from TICKET-060) ─────────────────

async function upsertRestaurantFromExtracted(
    supabase: any,
    extracted: ExtractedCandidate,
    userId: string,
    supabaseUrl: string,
    supabaseAnonKey: string,
    authHeader: string,
    abortSignal: AbortSignal,
    internalSecret?: string,
): Promise<{ restaurantId: string | null; confidence: ExtractedCandidate['confidence'] }> {
    if (!extracted.name) return { restaurantId: null, confidence: 'low' };

    if (extracted.google_place_id) {
        try {
            const placeCandidates = await callPlacesSearch(
                extracted.name, authHeader, supabaseUrl, supabaseAnonKey, abortSignal, internalSecret,
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
                        country: top.country,
                        address: top.formattedAddress ?? extracted.address,
                        verification: 'verified',
                    }, { onConflict: 'external_id' })
                    .select('id')
                    .single();
                return { restaurantId: upserted?.id ?? null, confidence: 'high' };
            }
        } catch (e: any) {
            throw e;
        }
    }

    if (extracted.confidence === 'low' || !extracted.name) {
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

    try {
        const query = [extracted.name, extracted.city].filter(Boolean).join(', ');
        const placeCandidates = await callPlacesSearch(
            query, authHeader, supabaseUrl, supabaseAnonKey, abortSignal, internalSecret,
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
    } catch (e: any) {
        throw e;
    }

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

// ── save_spots action (ARCH-REVIEW-2 #1 — lives in resolve-url) ───────────────

/** Full place payload forwarded by the client for metadata-complete upserts (fix-pass-2 item 3). */
interface SaveSpotPlacePayload {
    external_id?: string | null;
    name?: string | null;
    location?: { address?: string; locality?: string; country?: string };
    latitude?: number | null;
    longitude?: number | null;
    photoReference?: string | null;
    photoAttributionHtml?: string | null;
    googleRating?: number | null;
    googleRatingCount?: number | null;
    priceLevel?: number | null;
    cuisine?: string | null;
}

interface SaveSpotInput {
    candidate_id: string;
    client_nonce: string;            // uuid string
    restaurant_id: string | null;
    external_id: string | null;
    restaurant_name: string | null;
    restaurant_city: string | null;
    table_id?: string | null;
    table_client_nonce?: string | null;
    /** Full Places payload from the client — used in FIX#4 to upsert with all metadata. */
    place?: SaveSpotPlacePayload | null;
}

async function handleSaveSpots(
    supabase: any,
    user: { id: string },
    body: Record<string, unknown>,
): Promise<Response> {
    const importNonce = body['import_nonce'] as string | undefined;
    const spots = body['spots'] as SaveSpotInput[] | undefined;
    // FIX #1: pass source as-is (object), never JSON.stringify — supabase-js
    // serializes jsonb objects itself; stringifying produces a jsonb STRING
    // which fails the wishlist_items_source_shape CHECK (jsonb_typeof='object').
    // cf. table-shares/index.ts:227 canonical pattern.
    const source = body['source'] as unknown;
    const note = typeof body['note'] === 'string' ? body['note'] : null;

    if (!importNonce || !Array.isArray(spots) || spots.length === 0) {
        return errorResponse('INVALID_BODY', 'import_nonce and spots[] are required', 400);
    }

    // Cap at 6 per spec
    const capped = spots.slice(0, 6);

    // ── FIX #3 (P1): validate table memberships BEFORE calling the RPC ──────
    // member_id doctrine (TICKET-034): the column is member_id, NOT user_id.
    // Unauthorized table_ids are short-circuited here and never reach the RPC.
    const tableIdsToCheck = [...new Set(
        capped
            .map((s) => s.table_id ?? null)
            .filter((t): t is string => t !== null),
    )];

    // Item 6 (fix-pass-2): call the exported helper so the deno test guards this path
    // rather than maintaining a duplicate implementation here.
    let unauthorizedTableIds = new Set<string>();
    if (tableIdsToCheck.length > 0) {
        const { data: memberRows } = await supabase
            .from('table_members')
            .select('table_id')
            .eq('member_id', user.id)  // member_id, NOT user_id (TICKET-034)
            .in('table_id', tableIdsToCheck);
        unauthorizedTableIds = filterUnauthorizedTableIds(tableIdsToCheck, memberRows ?? []);
    }

    const results: Array<{
        candidate_id: string;
        client_nonce: string;
        status: 'saved' | 'already_pinned' | 'failed';
        wishlist_id?: string | null;
        restaurant_id?: string | null;
        error?: string;
        code?: string;
    }> = [];

    for (const spot of capped) {
        // FIX #3: early fail for unauthorized table_ids
        if (spot.table_id && unauthorizedTableIds.has(spot.table_id)) {
            results.push({
                candidate_id: spot.candidate_id,
                client_nonce: spot.client_nonce,
                status: 'failed',
                error: 'not a member of this table',
                code: 'NOT_A_MEMBER',
            });
            continue;
        }

        // FIX #2: sanitize client-sent 'ghost_pending' sentinel to null.
        // The RPC mints a stable ghost external_id from (user, client_nonce) when
        // both restaurant_id and external_id are null.
        const safeExternalId = isGhostExternalId(spot.external_id) ? null : (spot.external_id ?? null);

        // FIX #4 (High): for resolved-Places spots (real external_id, no restaurant_id),
        // upsert the restaurant NOW and pass the resulting restaurant_id to the RPC.
        // This prevents Places-resolved candidates from degrading to unverified ghosts
        // via the external_id branch of fn_save_import_spot.
        // Fix-pass-2 item 3: when the client forwards a full `place` payload, use ALL
        // metadata fields so first-time saves get the complete restaurant record rather
        // than name+city only (metadata regression fix).
        let resolvedRestaurantId = spot.restaurant_id ?? null;
        if (!resolvedRestaurantId && safeExternalId) {
            try {
                const p = spot.place;
                resolvedRestaurantId = await upsertRestaurant(supabase, {
                    external_id: safeExternalId,
                    name: p?.name ?? spot.restaurant_name ?? 'Unknown',
                    location: {
                        address: p?.location?.address ?? undefined,
                        locality: p?.location?.locality ?? spot.restaurant_city ?? undefined,
                        country: p?.location?.country ?? undefined,
                    },
                    latitude: p?.latitude ?? undefined,
                    longitude: p?.longitude ?? undefined,
                    photoReference: p?.photoReference ?? undefined,
                    photoAttributionHtml: p?.photoAttributionHtml ?? null,
                    googleRating: p?.googleRating ?? undefined,
                    googleRatingCount: p?.googleRatingCount ?? undefined,
                    priceLevel: p?.priceLevel ?? undefined,
                    cuisine: p?.cuisine ?? undefined,
                    verification: 'verified',
                });
            } catch {
                // Non-fatal: fall through to the RPC's external_id branch
                // (it will retry the upsert there as verified as well).
            }
        }

        try {
            const { data: rpcResult, error: rpcError } = await supabase.rpc('fn_save_import_spot', {
                p_user_id: user.id,
                p_import_nonce: importNonce,
                p_client_nonce: spot.client_nonce,
                p_restaurant_id: resolvedRestaurantId,
                p_external_id: resolvedRestaurantId ? null : safeExternalId,
                p_restaurant_name: spot.restaurant_name ?? null,
                p_restaurant_city: spot.restaurant_city ?? null,
                // FIX #1: pass source as the object value, not JSON.stringify(source)
                p_source: source ?? null,
                p_note: note,
                p_table_id: spot.table_id ?? null,
                p_table_client_nonce: spot.table_client_nonce ?? null,
            });

            if (rpcError) {
                results.push({
                    candidate_id: spot.candidate_id,
                    client_nonce: spot.client_nonce,
                    status: 'failed',
                    error: rpcError.message ?? 'rpc error',
                });
                continue;
            }

            const r = rpcResult as Record<string, unknown> | null;
            results.push({
                candidate_id: spot.candidate_id,
                client_nonce: spot.client_nonce,
                status: (r?.['status'] as any) ?? 'failed',
                wishlist_id: (r?.['wishlist_id'] as string) ?? null,
                restaurant_id: (r?.['restaurant_id'] as string) ?? null,
                error: r?.['status'] === 'failed' ? (r?.['error'] as string) : undefined,
            });
        } catch (e: any) {
            results.push({
                candidate_id: spot.candidate_id,
                client_nonce: spot.client_nonce,
                status: 'failed',
                error: e?.message ?? 'unexpected error',
            });
        }
    }

    const savedCount = results.filter((r) => r.status === 'saved').length;
    const alreadyCount = results.filter((r) => r.status === 'already_pinned').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;

    return jsonResponse({
        data: {
            results,
            summary: { saved: savedCount, already_pinned: alreadyCount, failed: failedCount },
        },
    });
}

// ── Main pipeline (TICKET-063 multi-candidate URL path) ───────────────────────

async function handleUrlResolve(
    supabase: any,
    user: { id: string },
    rawUrl: string,
    parsedUrl: URL,
    sourceType: SourceType,
    caption: string | null,
    authHeader: string,
    supabaseUrl: string,
    supabaseAnonKey: string,
): Promise<Response> {
    const deadline = new Deadline(8000);

    let query: string | null = null;
    let notePrefill = '';
    let partialSource: Omit<WishlistSourceTikTok, 'type' | 'url'> | null = null;
    let thumbnailUrl: string | null = null;
    let oEmbedCaption: string | null = null;

    // ── Step 1: source-specific query extraction ──────────────────────────────
    if (sourceType === 'tiktok') {
        if (deadline.aborted) {
            return errorResponse('TIMEOUT', 'Resolver timed out', 503);
        }
        let oEmbed: Awaited<ReturnType<typeof fetchTikTokOEmbed>> = null;
        try {
            oEmbed = await fetchTikTokOEmbed(rawUrl, deadline.stageSignal(2500));
        } catch (e: any) {
            if (e?.name === 'AbortError' || deadline.aborted) {
                return errorResponse('TIMEOUT', 'Resolver timed out', 503);
            }
            if (e?.code === 'UPSTREAM_RATE_LIMITED') {
                return errorResponse('UPSTREAM_RATE_LIMITED', 'TikTok is busy — try again in a minute', 503);
            }
            return errorResponse('UPSTREAM_UNAVAILABLE', 'Could not reach TikTok — try again', 503);
        }

        if (oEmbed) {
            notePrefill = captionToNote(oEmbed.title);
            oEmbedCaption = oEmbed.title;
            const firstLine = oEmbed.title.split(/\n/)[0].trim();
            query = firstLine.length > 0 ? firstLine : oEmbed.title;
            thumbnailUrl = oEmbed.thumbnail_url ?? null;

            const partial: Omit<WishlistSourceTikTok, 'type' | 'url'> = {};
            if (oEmbed.thumbnail_url) partial.thumbnail_url = oEmbed.thumbnail_url;
            if (oEmbed.author_unique_id) partial.author_handle = oEmbed.author_unique_id;
            if (oEmbed.author_name) partial.author_name = oEmbed.author_name;
            if (oEmbed.embed_product_id) partial.embed_product_id = oEmbed.embed_product_id;
            partialSource = partial;
        }
    } else if (sourceType === 'google_maps') {
        const pathParts = parsedUrl.pathname.split('/');
        const placeIndex = pathParts.findIndex((p) => p === 'place' || p === 'Place');
        if (placeIndex >= 0 && pathParts[placeIndex + 1]) {
            query = decodeURIComponent(pathParts[placeIndex + 1]).replace(/\+/g, ' ');
        } else {
            query = parsedUrl.searchParams.get('q') ?? parsedUrl.searchParams.get('query');
        }
    } else if (sourceType === 'web') {
        const title = await unfurlWebTitle(rawUrl, deadline.stageSignal(2000)).catch(() => null);
        if (title) {
            query = title.replace(/\s*[\|—\-]\s*.+$/, '').trim();
            oEmbedCaption = title;
        }
    }

    // ── Step 2: cache check ───────────────────────────────────────────────────
    const contentHash = await hashTextSource(rawUrl, oEmbedCaption);
    const modelId = Deno.env.get('EXTRACTION_MODEL') ?? 'claude-haiku-4-5-20251001';

    let textCandidates: ExtractedCandidate[] = [];
    let visionCandidates: ExtractedCandidate[] = [];
    let fromCache = false;

    const cached = await readExtractionCache(supabase, contentHash);
    if (cached && cached.length > 0) {
        textCandidates = cached;
        fromCache = true;
    }

    // ── Step 3: text-tier extraction ──────────────────────────────────────────
    if (!fromCache && oEmbedCaption && !deadline.aborted) {
        try {
            const extracted = await extractFromTextMulti(oEmbedCaption, deadline.stageSignal(2500));
            textCandidates = extracted;
        } catch (e: any) {
            if (e?.name === 'AbortError') {
                // Budget exhausted — proceed with empty (degrade gracefully)
            }
        }
    }

    // ── Step 4: listicle detection + vision trigger ───────────────────────────
    const captionForListicle = oEmbedCaption ?? query ?? '';
    const listMarker = detectListMarker(captionForListicle);
    const highConfCount = textCandidates.filter((c) => c.confidence === 'high' || c.confidence === 'exact').length;

    const needsVision =
        thumbnailUrl &&
        !fromCache &&
        !deadline.aborted &&
        (
            highConfCount === 0 ||
            (listMarker.isList && textCandidates.length < Math.min(listMarker.count ?? 6, 6))
        );

    if (needsVision && thumbnailUrl) {
        // Fetch + resize thumbnail (ARCH-REVIEW-2 #11: skip vision if resize fails)
        const resized = await fetchAndResizeThumbnail(thumbnailUrl, deadline.stageSignal(2000));
        if (resized && !deadline.aborted) {
            try {
                const vExtracted = await extractFromVisionMulti(
                    resized.base64, resized.mimeType, oEmbedCaption ?? undefined,
                    deadline.stageSignal(2500),
                );
                visionCandidates = vExtracted;
            } catch {
                // Vision failed — text-tier results stand
            }
        }
        // If resized is null (ARCH-REVIEW-2 #11): vision skipped entirely
    }

    // ── Step 5: merge + dedupe + rank + cap-6 ─────────────────────────────────
    const staged = dedupeAndRank(textCandidates, visionCandidates);

    // ── Step 6: cache write (content-derived only, before Places) ────────────
    if (!fromCache && staged.length > 0) {
        const cacheArr = staged.map((s) => s.extracted);
        writeExtractionCache(supabase, contentHash, rawUrl, cacheArr, modelId).catch(() => null);
    }

    // ── Step 7: per-candidate Places resolution (parallel ≤6) ────────────────
    // Short-circuit candidates with existing google_place_id via DB lookup (free).
    // Google-Maps source type: don't run model extraction; use direct Places search.
    let resolvedPlaces: (PlacesPayload | null)[] = [];

    if (sourceType === 'google_maps' && query) {
        // Google Maps: single Places search, no model extraction needed
        try {
            const results = await callPlacesSearch(
                query, authHeader, supabaseUrl, supabaseAnonKey,
                deadline.stageSignal(2500),
            );
            resolvedPlaces = results.slice(0, 3).map((r) => r);
        } catch {
            resolvedPlaces = [];
        }

        // Map to PlacesPayload[] for the canonical resolution path below
        const googlePlaceIds = resolvedPlaces.filter(Boolean).map((p) => p!.id);
        const { data: restaurantRows } = googlePlaceIds.length > 0
            ? await supabase.from('restaurants').select('id, external_id').in('external_id', googlePlaceIds)
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

        const candidates: ResolvedCandidate[] = await Promise.all(
            (resolvedPlaces.filter(Boolean) as PlacesPayload[]).slice(0, 3).map(async (place, idx) => {
                const restaurantId = placeIdToRestaurantId.get(place.id) ?? null;
                const alreadyWishlisted = restaurantId ? wishlistedSet.has(restaurantId) : false;
                // FIX #6: Google Maps URL parse is a deterministic source → 'exact' for top result.
                // Confidence enum: exact = deterministic source (google_maps URL parse or visible place_id).
                const confidence: Confidence = idx === 0 ? 'exact' : 'low';
                const restaurant: PlacesPayload = {
                    ...place,
                    external_id: place.id,
                    location: {
                        address: place.formattedAddress ?? undefined,
                        locality: place.city ?? undefined,
                        country: place.country ?? undefined,
                    },
                };
                const candidateId = await computeCandidateId(contentHash, normalizeName(place.name), idx);
                return {
                    candidate_id: candidateId,
                    restaurant,
                    confidence,
                    google_place_id: place.id,
                    restaurant_id: restaurantId,
                    already_wishlisted: alreadyWishlisted,
                    city_inferred: false,
                };
            })
        );

        return jsonResponse({
            data: {
                source_type: sourceType,
                best_query: query,
                note_prefill: notePrefill,
                candidates,
                partial_source: partialSource,
                list_count: listMarker.count,
            } satisfies ResolveUrlResponse,
        });
    }

    // For non-Maps sources: resolve staged candidates in parallel
    if (staged.length === 0) {
        // No candidates from model extraction — fall back to old direct Places search
        if (!query) {
            return jsonResponse({
                data: {
                    source_type: sourceType,
                    best_query: null,
                    note_prefill: notePrefill,
                    candidates: [],
                    partial_source: partialSource,
                    list_count: listMarker.count,
                } satisfies ResolveUrlResponse,
            });
        }

        // Direct Places search on the caption-derived query
        let placeCandidates: PlacesPayload[] = [];
        try {
            placeCandidates = await callPlacesSearch(
                query, authHeader, supabaseUrl, supabaseAnonKey,
                deadline.stageSignal(2500),
            );
        } catch (e: any) {
            if (e?.code === 'PLACES_RATE_LIMITED') {
                return errorResponse('PLACES_RATE_LIMITED', 'Search is temporarily unavailable — try again', 503);
            }
            if (deadline.aborted) {
                return errorResponse('TIMEOUT', 'Resolver timed out', 503);
            }
            return errorResponse('UPSTREAM_UNAVAILABLE', 'Could not complete search — try again', 503);
        }

        return buildLegacyCandidateResponse(
            supabase, user, placeCandidates, sourceType, query, notePrefill, partialSource,
            contentHash, listMarker.count,
        );
    }

    // Resolve staged model candidates to Places in parallel (≤6)
    const placeSignal = deadline.stageSignal(2500);
    const placeResults = await Promise.all(
        staged.map(async (s) => {
            if (placeSignal.aborted) return null;
            try {
                return await resolveCandidateToPlace(
                    supabase, s.extracted, authHeader, supabaseUrl, supabaseAnonKey, placeSignal,
                );
            } catch {
                return null;
            }
        })
    );

    // ── Step 8: post-Places dedupe by google_place_id ─────────────────────────
    const seenPlaceIds = new Set<string>();
    const dedupedStaged: Array<{ staged: typeof staged[0]; place: PlacesPayload | null }> = [];
    for (let i = 0; i < staged.length; i++) {
        const place = placeResults[i];
        const placeId = place?.id ?? staged[i].extracted.google_place_id;
        if (placeId && seenPlaceIds.has(placeId)) continue;
        if (placeId) seenPlaceIds.add(placeId);
        dedupedStaged.push({ staged: staged[i], place });
    }

    // ── Step 9: wishlist dedupe ───────────────────────────────────────────────
    const allPlaceIds = dedupedStaged
        .map((d) => d.place?.id)
        .filter(Boolean) as string[];

    const { data: restaurantRows } = allPlaceIds.length > 0
        ? await supabase.from('restaurants').select('id, external_id, verification').in('external_id', allPlaceIds)
        : { data: [] };

    // ROUND-3 FIX: map ONLY verified rows. Mapping an unverified (stale ghost)
    // row here hands the client a restaurant_id, the client then nulls
    // external_id, and the save path skips the verified upsert — the repair
    // never happens. Unverified rows stay unmapped so the candidate flows the
    // external_id path and save-time upsert promotes the SAME row (ON CONFLICT
    // external_id) to verified with full metadata.
    const placeIdToRestaurantId = mapVerifiedRestaurantIds(restaurantRows ?? []);

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

    // ── Step 10: build candidates[] ──────────────────────────────────────────
    const candidates: ResolvedCandidate[] = await Promise.all(
        dedupedStaged.slice(0, 6).map(async ({ staged: s, place }, idx) => {
            const restaurantId = place ? (placeIdToRestaurantId.get(place.id) ?? null) : null;
            const alreadyWishlisted = restaurantId ? wishlistedSet.has(restaurantId) : false;
            const confidence: Confidence = s.extracted.confidence === 'high' ? 'high' : 'low';
            const candidateId = await computeCandidateId(
                contentHash,
                normalizeName(s.extracted.name),
                idx,
            );

            const restaurant: PlacesPayload = place
                ? {
                    ...place,
                    external_id: place.id,
                    location: {
                        address: place.formattedAddress ?? undefined,
                        locality: place.city ?? undefined,
                        country: place.country ?? undefined,
                    },
                }
                : {
                    // FIX #2: ghost candidates use external_id=null (not 'ghost_pending').
                    // The RPC mints 'ghost_{user}_{nonce}' at save time for true ghosts.
                    id: '',
                    name: s.extracted.name,
                    formattedAddress: s.extracted.address,
                    city: s.extracted.city,
                    country: null,
                    latitude: null,
                    longitude: null,
                    categories: [],
                    cuisine: s.extracted.cuisine,
                    googleRating: null,
                    googleRatingCount: null,
                    priceLevel: null,
                    photoReference: null,
                    website: null,
                    link: null,
                    external_id: null,
                    location: {
                        address: s.extracted.address ?? undefined,
                        locality: s.extracted.city ?? undefined,
                    },
                };

            return {
                candidate_id: candidateId,
                restaurant,
                confidence,
                // FIX #2: google_place_id is null for unresolved ghosts.
                google_place_id: place?.id ?? s.extracted.google_place_id ?? null,
                restaurant_id: restaurantId,
                already_wishlisted: alreadyWishlisted,
                city_inferred: s.extracted.city_inferred,
            };
        })
    );

    // best_query = top candidate name + city (or cleaned caption fallback)
    const topCandidate = staged[0]?.extracted;
    const bestQuery = topCandidate?.name
        ? [topCandidate.name, topCandidate.city].filter(Boolean).join(', ')
        : query;

    return jsonResponse({
        data: {
            source_type: sourceType,
            best_query: bestQuery,
            note_prefill: notePrefill,
            candidates,
            partial_source: partialSource,
            list_count: listMarker.count,
        } satisfies ResolveUrlResponse,
    });
}

/**
 * Build the legacy (pre-model) candidates response for the old direct-Places path.
 * Used when model extraction yields zero candidates and we fall back to raw query search.
 */
async function buildLegacyCandidateResponse(
    supabase: any,
    user: { id: string },
    placeCandidates: PlacesPayload[],
    sourceType: SourceType,
    query: string,
    notePrefill: string,
    partialSource: Omit<WishlistSourceTikTok, 'type' | 'url'> | null,
    contentHash: string,
    listCount: number | null,
): Promise<Response> {
    if (placeCandidates.length === 0) {
        return jsonResponse({
            data: {
                source_type: sourceType,
                best_query: query,
                note_prefill: notePrefill,
                candidates: [],
                partial_source: partialSource,
                list_count: listCount,
            } satisfies ResolveUrlResponse,
        });
    }

    const googlePlaceIds = placeCandidates.map((p) => p.id).filter(Boolean);
    const { data: restaurantRows } = await supabase
        .from('restaurants')
        .select('id, external_id')
        .in('external_id', googlePlaceIds);

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
    const candidates: ResolvedCandidate[] = await Promise.all(
        topN.map(async (place, idx): Promise<ResolvedCandidate> => {
            const restaurantId = placeIdToRestaurantId.get(place.id) ?? null;
            const alreadyWishlisted = restaurantId ? wishlistedSet.has(restaurantId) : false;
            let confidence: Confidence = 'low';
            if (idx === 0 && (place.googleRatingCount ?? 0) > 50) confidence = 'high';
            const restaurant: PlacesPayload = {
                ...place,
                external_id: place.id,
                location: {
                    address: place.formattedAddress ?? undefined,
                    locality: place.city ?? undefined,
                    country: place.country ?? undefined,
                },
            };
            const candidateId = await computeCandidateId(contentHash, normalizeName(place.name), idx);
            return {
                candidate_id: candidateId,
                restaurant,
                confidence,
                google_place_id: place.id,
                restaurant_id: restaurantId,
                already_wishlisted: alreadyWishlisted,
                city_inferred: false,
            };
        })
    );

    return jsonResponse({
        data: {
            source_type: sourceType,
            best_query: query,
            note_prefill: notePrefill,
            candidates,
            partial_source: partialSource,
            list_count: listCount,
        } satisfies ResolveUrlResponse,
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body: {
        url?: string;
        image_path?: string;
        caption?: string;
        action?: string;
        job_id?: string;
        import_nonce?: string;
        spots?: unknown[];
        source?: unknown;
        note?: string;
    };
    try {
        body = await req.json();
    } catch {
        return errorResponse('INVALID_BODY', 'Request body must be JSON', 400);
    }

    // ── [N1] Async extract action — INTERNAL ONLY ─────────────────────────────
    if (body?.action === 'extract' && body?.job_id) {
        const INTERNAL_CALL_SECRET = Deno.env.get('INTERNAL_CALL_SECRET') ?? '';
        const callerSecret = req.headers.get('x-internal-secret') ?? '';

        if (
            !INTERNAL_CALL_SECRET ||
            !timingSafeEqual(new TextEncoder().encode(callerSecret), new TextEncoder().encode(INTERNAL_CALL_SECRET))
        ) {
            return errorResponse('UNAUTHORIZED', 'Invalid or missing internal secret', 401);
        }

        const { data: jobRow } = await supabase
            .from('import_jobs')
            .select('user_id')
            .eq('job_id', body.job_id)
            .maybeSingle();
        if (!jobRow?.user_id) {
            return errorResponse('JOB_NOT_FOUND', 'Import job not found', 404);
        }
        const jobOwnerId = jobRow.user_id as string;

        return await handleAsyncExtract(
            supabase, true, jobOwnerId,
            body.job_id, supabaseUrl, supabaseAnonKey,
            `Bearer ${supabaseServiceKey}`,
            INTERNAL_CALL_SECRET,
        );
    }

    // ── Auth — all non-internal paths require a valid user JWT ────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
        return errorResponse('UNAUTHORIZED', 'Missing Authorization header', 401);
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
        return errorResponse('UNAUTHORIZED', 'Unauthorized', 401);
    }

    // ── save_spots action (ARCH-REVIEW-2 #1) ──────────────────────────────────
    if (body?.action === 'save_spots') {
        return handleSaveSpots(supabase, user, body as Record<string, unknown>);
    }

    const rawUrl = body?.url;
    const hasImage = typeof body?.image_path === 'string';
    if (!hasImage && (typeof rawUrl !== 'string' || !rawUrl)) {
        return errorResponse('INVALID_URL', 'url is required', 400);
    }

    // ── URL validation ────────────────────────────────────────────────────────
    let parsedUrl: URL | null = null;
    let sourceType: SourceType = 'screenshot';

    if (rawUrl) {
        const urlResult = validateUrl(rawUrl);
        if (urlResult.ok === false) {
            return errorResponse('INVALID_URL', `URL rejected: ${urlResult.reason}`, 400);
        }
        parsedUrl = urlResult.url;
    }

    // ── Rate limit ────────────────────────────────────────────────────────────
    const { data: rateRows, error: rateError } = await supabase.rpc(
        'check_and_increment_rate_limit',
        { p_user_id: user.id, p_bucket_key: 'resolve_url', p_max: 30, p_window_seconds: 3600 },
    );
    if (rateError) {
        console.error('Rate limit check failed:', rateError);
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

    // ── Instagram: login-walled — nudge screenshot ────────────────────────────
    if (sourceType === 'instagram') {
        const caption = body?.caption?.trim();
        let notePrefill = '';
        let query: string | null = null;
        if (caption) {
            notePrefill = captionToNote(caption);
            query = caption.split(/\n/)[0].trim() || caption;
        }
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

    // ── Vision/screenshot path: image_path supplied ───────────────────────────
    if (hasImage && body?.image_path) {
        return handleVisionExtract(
            supabase, user, body.image_path, body?.caption ?? null,
            supabaseUrl, supabaseAnonKey, authHeader,
        );
    }

    // ── URL resolve pipeline (TICKET-063) ─────────────────────────────────────
    try {
        return await handleUrlResolve(
            supabase, user,
            rawUrl!, parsedUrl!,
            sourceType,
            body?.caption ?? null,
            authHeader,
            supabaseUrl,
            supabaseAnonKey,
        );
    } catch (e: any) {
        if (e?.name === 'AbortError') {
            return errorResponse('TIMEOUT', 'Resolver timed out', 503);
        }
        console.error('resolve-url error:', e);
        return errorResponse('INTERNAL', 'Internal server error', 500);
    }
});
