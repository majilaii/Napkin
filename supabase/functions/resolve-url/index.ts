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
import { reportError } from '../_shared/report.ts';
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
// TICKET-086c: dedupe/merge/rank + the Places similarity gate extracted to
// _shared so the stage implicated in the "7 spots → 1" regressions is
// unit-tested in pre-commit (candidateDedupe.test.ts).
import {
    dedupeAndRank,
    namesOverlap,
    normalizeName,
    type StagedCandidate,
} from '../_shared/candidateDedupe.ts';
import { detectListMarker } from '../_shared/listicle.ts';
import { resizeImageToLimit } from '../_shared/imageResize.ts';
import { upsertRestaurant } from '../_shared/restaurant.ts';
// TICKET-077: the handoff pin path re-reads the share LIVE (single source of truth,
// shared with handoff/share-page) so it pins against the CURRENT spot set, never a
// stale client-sent list.
import { loadHandoffWriteAuthorization } from '../handoff/snapshot.ts';

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

// TICKET-079: reddit/substack are recognized as their own source_type so the client
// can label them ("from reddit" / "from substack") and pick the right copy noun.
// They still flow the SAME unfurl→extraction path as 'web' (see isWebExtractionSource).
// SourceType + detection helpers live in _helpers.ts (testable without serve()).
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
    /** TICKET-086c: 'warned' = anti-recommendation ("most overrated") — the
     * client never auto-saves these; review shows them unticked. */
    stance?: 'recommended' | 'warned' | 'neutral' | null;
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

/**
 * Detect source type from a URL.
 *
 * Host-pattern detection (incl. TICKET-079 reddit/substack) lives in the pure,
 * testable detectSourceTypeFromHost helper. This wrapper layers on the one
 * path-dependent case the host helper can't see: www.google.com/maps/… (a maps
 * link whose host is the bare google.com).
 */
function detectSourceType(url: URL): SourceType {
    const host = url.hostname.toLowerCase();
    if (host === 'www.google.com' && url.pathname.startsWith('/maps')) {
        return 'google_maps';
    }
    return detectSourceTypeFromHost(host);
}

// ── Candidate dedup + merge + rank ────────────────────────────────────────────
// normalizeName / dedupeAndRank / mergeExtracted / namesOverlap live in
// _shared/candidateDedupe.ts (TICKET-086c) — imported above.

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
            const stanceRaw = p['stance'];
            return {
                name: typeof p['name'] === 'string' ? p['name'] || null : null,
                city: typeof p['city'] === 'string' ? p['city'] || null : null,
                city_inferred: p['city_inferred'] === true,
                // TICKET-086c: area + stance survive the cache round-trip (they
                // were silently dropped here, degrading Places queries and
                // losing the overrated flag on every cache hit).
                area: typeof p['area'] === 'string' ? p['area'] || null : null,
                cuisine: typeof p['cuisine'] === 'string' ? p['cuisine'] || null : null,
                address: typeof p['address'] === 'string' ? p['address'] || null : null,
                booking_url: typeof p['booking_url'] === 'string' ? p['booking_url'] || null : null,
                hours: typeof p['hours'] === 'string' ? p['hours'] || null : null,
                confidence: (['high', 'low', 'exact'].includes(conf as string) ? conf : 'low') as any,
                stance: (stanceRaw === 'recommended' || stanceRaw === 'warned' || stanceRaw === 'neutral')
                    ? stanceRaw
                    : undefined,
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
    // TICKET-086c: the fused perception text that produced this extraction.
    // Persisted so a bad real-world import becomes an eval fixture in one
    // query (scripts/eval/extraction) instead of being unreproducible.
    rawText: string | null = null,
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
                    area: c.area ?? null,
                    cuisine: c.cuisine,
                    address: c.address,
                    booking_url: c.booking_url,
                    hours: c.hours,
                    confidence: c.confidence,
                    stance: c.stance ?? null,
                    google_place_id: c.google_place_id,
                })),
            },
            model: modelId,
            raw_text: rawText,
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

/** Parse a place query from an EXPANDED Google Maps URL (/place/<name>/ or ?q=). */
function parsePlaceFromMapsUrl(u: string): string | null {
    try {
        const parsed = new URL(u);
        const parts = parsed.pathname.split('/');
        const i = parts.findIndex((p) => p === 'place' || p === 'Place');
        if (i >= 0 && parts[i + 1]) {
            return decodeURIComponent(parts[i + 1]).replace(/\+/g, ' ').trim() || null;
        }
        return parsed.searchParams.get('q') ?? parsed.searchParams.get('query');
    } catch {
        return null;
    }
}

/** "Carbone · Greenwich Village - Google Maps" → "Carbone · Greenwich Village" */
function cleanMapsTitle(t: string): string {
    return t.replace(/\s*[-–—|]\s*Google\s*Maps\s*$/i, '').trim();
}

/**
 * Google Maps SHARE links are short redirects (maps.app.goo.gl/…, goo.gl/maps/…)
 * with no /place/ segment. Follow the redirect to the canonical URL and parse
 * the place from it; fall back to the page's og:title / <title>. Fully fail-soft.
 */
async function expandMapsQuery(url: string, signal: AbortSignal): Promise<string | null> {
    try {
        const res = await fetch(url, {
            signal,
            redirect: 'follow',
            headers: { 'User-Agent': 'Napkin/1.0 (link-resolver; +https://napkin.app)' },
        });
        const fromUrl = parsePlaceFromMapsUrl(res.url || url);
        if (fromUrl) { res.body?.cancel().catch(() => {}); return fromUrl; }
        const text = await res.text().catch(() => null);
        if (text) {
            const og = text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,200})["']/i);
            if (og?.[1]) return cleanMapsTitle(og[1]) || null;
            const t = text.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
            if (t?.[1]) return cleanMapsTitle(t[1]) || null;
        }
        return null;
    } catch {
        return null;
    }
}

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
import {
    isGhostExternalId,
    buildGhostExternalId,
    filterUnauthorizedTableIds,
    mapVerifiedRestaurantIds,
    isSpotPinnable,
    detectSourceTypeFromHost,
    isWebExtractionSource,
    type SourceType,
} from './_helpers.ts';
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

    // No google_place_id → text search by name + area + city. The area
    // ("Belsize Park", "Dalston", "E11") disambiguates same-name places and
    // rescues ASR-denoised names (TICKET-086b).
    const query = [candidate.name, (candidate as { area?: string | null }).area ?? null, candidate.city]
        .filter(Boolean)
        .join(', ');
    try {
        const results = await callPlacesSearch(
            query, authHeader, supabaseUrl, supabaseAnonKey, signal,
        );
        const top = results[0] ?? null;
        // TICKET-086c similarity gate: a garbled name text-search returns SOME
        // popular place; accepting it blind masquerades as "resolved" and the
        // real spot silently leaves the funnel (post-Places dedupe can then
        // collapse two distinct spots onto the same wrong place). No plausible
        // name overlap → ghost instead; the review UI already handles ghosts.
        if (top && !namesOverlap(candidate.name, top.name)) return null;
        return top;
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

    // Fail-CLOSED (TICKET-091): a missing/errored rate row denies — a DB blip
    // must not uncork unlimited Anthropic + Places spend on the async path.
    const { data: rateRows } = await supabase.rpc(
        'check_and_increment_rate_limit',
        { p_user_id: jobOwnerId, p_bucket_key: 'resolve_content', p_max: 20, p_window_seconds: 3600 },
    ).catch(() => ({ data: null }));
    const rateRow = rateRows?.[0];
    if (!rateRow || !rateRow.allowed) {
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
    // TICKET-081: optional restaurant-page metadata forwarded from the client.
    // hours carries weekdayDescriptions only — no openNow (stale once cached; the page
    // derives "today" by matching the weekday name, not array position).
    phone?: string | null;
    website?: string | null;
    googleMapsUri?: string | null;
    google_maps_uri?: string | null;
    hours?: { weekdayDescriptions: string[] } | null;
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

    // Per-request cap — generous enough for video listicles (extraction caps at
    // 12) with abuse headroom. Was 6 (the old text-only spec), which silently
    // dropped spots 7+ of an 11-spot import → only 6 of 11 saved (TICKET-082).
    const capped = spots.slice(0, 20);

    // ── TICKET-072 ARCH-REVIEW-2 #1/#4 + TICKET-077: handoff_token gate ──────
    // When handoff_token is present, the server authorizes the pin against the
    // owner's LIVE state (never cached resolve data) and constructs `source`
    // authoritatively — client-sent source is ignored.
    //
    // TICKET-077: shares are live. We pin ONLY restaurant_ids in the owner's CURRENT
    // verified spot set; a restaurant_id the owner has since removed (or one from a
    // different share) is rejected, NOT trusted. sharer_name is the owner's LIVE name.
    //
    // TICKET-077 fix-pass (TOCTOU): the authoritative live read happens at the WRITE
    // BOUNDARY below (loadHandoffWriteAuthorization) — there is intentionally NO early
    // live load here, so nothing stale can leak into isSpotPinnable.
    const handoffToken = typeof body['handoff_token'] === 'string' ? body['handoff_token'] : null;
    let effectiveSource: unknown = source;
    // null ⇒ no handoff gate (normal import). A Set ⇒ handoff: the restaurant_ids
    // in the CURRENT live spot set; only these may be pinned. Both are assigned
    // ONLY at the write boundary below (TICKET-077 fix-pass — TOCTOU): there must
    // be exactly ONE authorization-relevant live read, and it must be as late as
    // possible so an owner removing a spot / deleting the list / de-verifying a
    // restaurant after the request begins cannot leave a stale set that pins.
    let liveRestaurantIds: Set<string> | null = null;

    const buildRevokedResponse = () => {
        const revokedResults = capped.map((spot) => ({
            candidate_id: spot.candidate_id,
            client_nonce: spot.client_nonce,
            status: 'failed' as const,
            error: 'share revoked or not found',
            code: 'SHARE_REVOKED',
        }));
        return jsonResponse({
            data: {
                results: revokedResults,
                summary: { saved: 0, already_pinned: 0, failed: revokedResults.length },
            },
        });
    };

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

    // ── TICKET-077 fix-pass (TOCTOU): ONE authoritative authorization read, at the
    // write boundary ──────────────────────────────────────────────────────────
    // This is the SOLE live read used to authorize a handoff pin. It runs here —
    // immediately before the per-spot write loop, AFTER the (potentially ~100 ms)
    // membership / upsert prep above — so it observes the owner's CURRENT state.
    // loadHandoffWriteAuthorization re-checks revocation AND re-loads the live spot
    // set in one place: if the owner removed a spot, deleted/unowned the list, or a
    // restaurant became unverified since the request began, the fresh set reflects
    // it and isSpotPinnable rejects those spots (NOT_IN_SHARE). There is no early
    // live load to drift from — see liveRestaurantIds declaration above.
    //
    // sharer_name (server-authoritative provenance, ARCH-2 #4) also comes from THIS
    // fresh read — the owner's CURRENT display name.
    //
    // Accepted residual: a revoke arriving WITHIN the loop (between individual
    // fn_save_import_spot calls) lets already-in-flight spots complete. This is
    // acceptable per the "copies-keep-living" doctrine — a recipient pinning
    // public restaurant names they already viewed at resolve time is near-zero harm.
    // Do NOT thread token state into fn_save_import_spot (too heavy for the harm
    // profile — ARCH-REVIEW-2 #2 rationale).
    if (handoffToken) {
        const auth = await loadHandoffWriteAuthorization(supabase, handoffToken);
        if (auth.revoked === true) {
            // Revoked, unknown, or list/owner gone NOW → all spots fail SHARE_REVOKED.
            return buildRevokedResponse();
        }
        liveRestaurantIds = auth.liveRestaurantIds;
        effectiveSource = { type: 'handoff', sharer_name: auth.sharerName };
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

        // TICKET-077: for a handoff pin, the spot MUST be in the share's CURRENT
        // live spot set. The client cannot smuggle a restaurant_id the owner has
        // since removed (or one from a different share) — we pin only what the
        // owner shares right now. (isSpotPinnable is the exported pure guard so the
        // deno test exercises this exact decision.)
        if (!isSpotPinnable(spot.restaurant_id, liveRestaurantIds)) {
            results.push({
                candidate_id: spot.candidate_id,
                client_nonce: spot.client_nonce,
                status: 'failed',
                error: 'spot is not in the shared set',
                code: 'NOT_IN_SHARE',
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
                    // TICKET-081: forward metadata too when present (additive).
                    phone: p?.phone ?? undefined,
                    website: p?.website ?? undefined,
                    googleMapsUri: p?.googleMapsUri ?? p?.google_maps_uri ?? undefined,
                    hours: p?.hours ?? undefined,
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
                // TICKET-072: use effectiveSource (handoff_token overrides client-sent source)
                p_source: effectiveSource ?? null,
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

    // The batch's server job_id (minted by the RPC keyed on import_nonce) so the
    // client toast can deep-link to /imports/[jobId] for review/fix. Nested
    // INSIDE data — callEdgeFn strips the outer envelope and drops siblings.
    let batchJobId: string | null = null;
    try {
        const { data: jobRow } = await supabase
            .from('import_jobs')
            .select('job_id')
            .eq('user_id', user.id)
            .eq('import_nonce', importNonce)
            .maybeSingle();
        batchJobId = jobRow?.job_id ?? null;
    } catch {
        /* link is optional — never fail the save over it */
    }

    return jsonResponse({
        data: {
            results,
            summary: { saved: savedCount, already_pinned: alreadyCount, failed: failedCount },
            job_id: batchJobId,
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
    // 086c: 8s → 12s. The 2.5s text-LLM stage aborted routinely, silently
    // falling back to a raw 3-place caption search — the founder's "3 random
    // spots" runs. This path also serves the background import queue, where
    // wall time is invisible; the interactive sheet shows a spinner.
    const deadline = new Deadline(12000);

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
        // Already-expanded links: parse directly.
        query = parsePlaceFromMapsUrl(rawUrl);
        // Share links (maps.app.goo.gl/…) are short redirects with no place
        // segment — follow the redirect to recover the place name.
        if (!query) {
            query = await expandMapsQuery(rawUrl, deadline.stageSignal(2500));
        }
    } else if (isWebExtractionSource(sourceType)) {
        // TICKET-079: 'web' + reddit/substack all unfurl the page <title> here.
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
            const extracted = await extractFromTextMulti(oEmbedCaption, deadline.stageSignal(5000));
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
        writeExtractionCache(supabase, contentHash, rawUrl, cacheArr, modelId, oEmbedCaption)
            .catch(() => null);
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
            // 086c: 'exact' was being demoted to 'low' here for no reason.
            const confidence: Confidence =
                s.extracted.confidence === 'high' || s.extracted.confidence === 'exact' ? 'high' : 'low';
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
                stance: s.extracted.stance ?? null,
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

/**
 * TICKET-082 — resolve restaurants from on-device-extracted video text.
 *
 * The client runs Vision OCR (frame overlays) + Speech transcription (voiceover)
 * on the phone and POSTs the combined text. We feed it through the SAME
 * multi-candidate text extractor the TikTok caption path uses, then resolve each
 * candidate to a Place. Mirrors handleUrlResolve's text-tier + resolution
 * (steps 3,5,7–10) minus oEmbed/thumbnail-vision/deadline-budget — the heavy
 * perception already happened for free on-device. Cap raised to 12 (listicles
 * routinely run to 10–11 spots, vs the URL path's 6).
 */
async function handleVideoText(
    supabase: any,
    user: { id: string },
    extractedText: string,
    caption: string | null,
    authHeader: string,
    supabaseUrl: string,
    supabaseAnonKey: string,
): Promise<Response> {
    const sourceType: SourceType = 'video';
    const notePrefill = caption ? captionToNote(caption) : '';
    const CAP = 12;

    // Caption (hashtags/handle → city hints) joins the on-device text.
    const fullText = [caption, extractedText].filter(Boolean).join('\n').slice(0, 8000);
    const listMarker = detectListMarker(fullText);

    // Content hash for cache + stable candidate ids (re-importing a clip is free).
    const hashBuf = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`video:${fullText}`).buffer as ArrayBuffer,
    );
    const contentHash = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    const modelId = Deno.env.get('EXTRACTION_MODEL') ?? 'claude-haiku-4-5-20251001';

    let textCandidates = await readExtractionCache(supabase, contentHash);
    if (!textCandidates || textCandidates.length === 0) {
        // Bound the (paid) model call — URL path uses a deadline budget; here we
        // didn't pay for on-device perception, but a hung extraction still needs
        // a graceful ceiling.
        const extractAc = new AbortController();
        // 086c: 7s → 15s. A 12-candidate haiku response (now with a retry on
        // malformed JSON) can exceed 7s; an abort here silently returned []
        // and the whole import read as "no spots found".
        const extractTimer = setTimeout(() => extractAc.abort(), 15000);
        try {
            textCandidates = await extractFromTextMulti(fullText, extractAc.signal, CAP);
        } catch {
            textCandidates = [];
        } finally {
            clearTimeout(extractTimer);
        }
        if (textCandidates.length > 0) {
            writeExtractionCache(supabase, contentHash, null, textCandidates, modelId, fullText)
                .catch(() => null);
        }
    }

    // CAP=12: listicles routinely run to 10–11 spots. dedupeAndRank's default
    // cap is 6 (right for the URL path); the video path passes 12 explicitly.
    const staged = dedupeAndRank(textCandidates ?? [], [], CAP);
    if (staged.length === 0) {
        return jsonResponse({
            data: {
                source_type: sourceType,
                best_query: null,
                note_prefill: notePrefill,
                candidates: [],
                partial_source: null,
                list_count: listMarker.count,
            } satisfies ResolveUrlResponse,
        });
    }

    // Resolve each candidate to a Place in parallel (bounded).
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 9000);
    let placeResults: (PlacesPayload | null)[];
    try {
        placeResults = await Promise.all(
            staged.map(async (s) => {
                try {
                    return await resolveCandidateToPlace(
                        supabase, s.extracted, authHeader, supabaseUrl, supabaseAnonKey, ac.signal,
                    );
                } catch {
                    return null;
                }
            }),
        );
    } finally {
        clearTimeout(timer);
    }

    // Post-Places dedupe by google_place_id.
    const seenPlaceIds = new Set<string>();
    const deduped: Array<{ s: StagedCandidate; place: PlacesPayload | null }> = [];
    for (let i = 0; i < staged.length; i++) {
        const place = placeResults[i];
        const placeId = place?.id ?? staged[i].extracted.google_place_id;
        if (placeId && seenPlaceIds.has(placeId)) continue;
        if (placeId) seenPlaceIds.add(placeId);
        deduped.push({ s: staged[i], place });
    }

    // Map verified restaurants + wishlist dedupe.
    const allPlaceIds = deduped.map((d) => d.place?.id).filter(Boolean) as string[];
    const { data: restaurantRows } = allPlaceIds.length > 0
        ? await supabase.from('restaurants').select('id, external_id, verification').in('external_id', allPlaceIds)
        : { data: [] };
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

    const candidates: ResolvedCandidate[] = await Promise.all(
        deduped.slice(0, CAP).map(async ({ s, place }, idx) => {
            const restaurantId = place ? (placeIdToRestaurantId.get(place.id) ?? null) : null;
            const alreadyWishlisted = restaurantId ? wishlistedSet.has(restaurantId) : false;
            // 086c: 'exact' was being demoted to 'low' here for no reason.
            const confidence: Confidence =
                s.extracted.confidence === 'high' || s.extracted.confidence === 'exact' ? 'high' : 'low';
            const candidateId = await computeCandidateId(contentHash, normalizeName(s.extracted.name), idx);
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
                google_place_id: place?.id ?? s.extracted.google_place_id ?? null,
                restaurant_id: restaurantId,
                already_wishlisted: alreadyWishlisted,
                city_inferred: s.extracted.city_inferred,
                stance: s.extracted.stance ?? null,
            };
        }),
    );

    const top = staged[0]?.extracted;
    const bestQuery = top?.name ? [top.name, top.city].filter(Boolean).join(', ') : null;

    return jsonResponse({
        data: {
            source_type: sourceType,
            best_query: bestQuery,
            note_prefill: notePrefill,
            candidates,
            partial_source: null,
            list_count: listMarker.count,
        } satisfies ResolveUrlResponse,
    });
}

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
        /** TICKET-082: on-device video OCR + voiceover transcript (text-only path). */
        extracted_text?: string;
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

    // ── Video text path (TICKET-082): on-device OCR/transcript supplied ────────
    // The phone did the heavy perception (Vision OCR + Speech) for free; we only
    // run the cheap text extractor + Places resolution here. No URL required.
    const extractedText = typeof body?.extracted_text === 'string' ? body.extracted_text.trim() : '';
    if (extractedText) {
        // Fail-CLOSED (TICKET-091): RPC error or missing row denies.
        const { data: rlRows, error: rlErr } = await supabase.rpc('check_and_increment_rate_limit', {
            p_user_id: user.id, p_bucket_key: 'resolve_url', p_max: 30, p_window_seconds: 3600,
        });
        const rlRow = rlRows?.[0];
        if (rlErr || !rlRow || !rlRow.allowed) {
            if (rlErr) console.error('resolve-url video-text rate check failed:', rlErr);
            return jsonResponse(
                { error: { code: 'RATE_LIMITED', message: 'Too many requests', details: { retry_after_seconds: rlRow?.retry_after_seconds ?? 60 } } },
                429,
            );
        }
        try {
            return await handleVideoText(
                supabase, user, extractedText, body?.caption ?? null,
                authHeader, supabaseUrl, supabaseAnonKey,
            );
        } catch (e: any) {
            console.error('resolve-url video-text error:', e);
            return errorResponse('INTERNAL', 'Internal server error', 500);
        }
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
    // Fail-CLOSED (TICKET-091): RPC error or missing row denies — this branch
    // previously logged-and-continued, letting a DB blip bypass the throttle.
    const { data: rateRows, error: rateError } = await supabase.rpc(
        'check_and_increment_rate_limit',
        { p_user_id: user.id, p_bucket_key: 'resolve_url', p_max: 30, p_window_seconds: 3600 },
    );
    const rateRow = rateRows?.[0];
    if (rateError || !rateRow || !rateRow.allowed) {
        if (rateError) console.error('Rate limit check failed:', rateError);
        return jsonResponse(
            { error: { code: 'RATE_LIMITED', message: 'Too many requests', details: { retry_after_seconds: rateRow?.retry_after_seconds ?? 60 } } },
            429,
        );
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
        reportError(e, { fn: 'resolve-url' });
        return errorResponse('INTERNAL', 'Internal server error', 500);
    }
});
