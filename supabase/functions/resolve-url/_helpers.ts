/**
 * resolve-url pure helpers — extracted for unit testing.
 *
 * These functions contain no I/O and no Deno.serve() — safe to import
 * in test files without triggering the HTTP server.
 *
 * TICKET-063 fix-pass-1.
 */

// ── Source detection (TICKET-079) ─────────────────────────────────────────────

/**
 * The source_type values resolve-url can emit for a URL/image share.
 * Mirrors the SourceType union in index.ts (kept in sync — this is the testable copy).
 */
export type SourceType =
    | 'tiktok'
    | 'google_maps'
    | 'web'
    | 'instagram'
    | 'reddit'
    | 'substack'
    | 'screenshot'
    | 'vision'
    | 'video';

/**
 * Detect the source_type from a URL host.
 *
 * TICKET-079: reddit + substack are labeled distinctly (so copy can say
 * "from reddit" / "from substack" and pick the right noun) but are extracted via
 * the SAME generic web-title → Places path as 'web' (see isWebExtractionSource).
 *
 * Unrecognized hosts → 'web'.
 */
export function detectSourceTypeFromHost(host: string): SourceType {
    const h = host.toLowerCase();
    if (h === 'tiktok.com' || h === 'www.tiktok.com' || h === 'vm.tiktok.com' || h === 'm.tiktok.com') {
        return 'tiktok';
    }
    if (h === 'maps.app.goo.gl' || h === 'maps.google.com' || h === 'goo.gl') {
        return 'google_maps';
    }
    if (h === 'instagram.com' || h === 'www.instagram.com') {
        return 'instagram';
    }
    if (h === 'reddit.com' || h === 'www.reddit.com' || h === 'redd.it' || h.endsWith('.reddit.com')) {
        return 'reddit';
    }
    if (h === 'substack.com' || h.endsWith('.substack.com')) {
        return 'substack';
    }
    return 'web';
}

/**
 * TICKET-079: reddit/substack are labeled distinctly but extracted exactly like a
 * generic web page (unfurl <title> → text extraction → Places). Anywhere the
 * pipeline forks on "is this the web path?", use this instead of `=== 'web'`.
 *
 * This guarantees reddit/substack never mislabel as video and never 500 — they
 * degrade to manual search like any noisy-title web page if extraction is poor.
 */
export function isWebExtractionSource(s: SourceType): boolean {
    return s === 'web' || s === 'reddit' || s === 'substack';
}

/**
 * Returns true when an external_id value represents an unresolved ghost
 * candidate (null, empty string, or the legacy 'ghost_pending' sentinel).
 * The minted ghost external_id ('ghost_<user>_<nonce>') is NOT a sentinel
 * and returns false.
 */
export function isGhostExternalId(id: string | null | undefined): boolean {
    return !id || id === 'ghost_pending' || id === '';
}

/**
 * Builds the stable ghost external_id for a (user, nonce) pair.
 * Pattern mirrors the SQL in fn_save_import_spot:
 *   'ghost_' || p_user_id::text || '_' || p_client_nonce::text
 *
 * NOTE: The SQL expression in migration 20260610000300_fix_save_import_spot.sql is
 * AUTHORITATIVE. This TypeScript mirror must stay in sync with that SQL. If the SQL
 * pattern changes, update this function to match.
 */
export function buildGhostExternalId(userId: string, clientNonce: string): string {
    return `ghost_${userId}_${clientNonce}`;
}

/**
 * Returns the set of table_ids the user is NOT authorized to write to.
 * The memberRows must be queried with member_id = user_id (TICKET-034 doctrine).
 */
export function filterUnauthorizedTableIds(
    tableIds: string[],
    memberRows: { table_id: string }[],
): Set<string> {
    const authorized = new Set(memberRows.map((r) => r.table_id));
    const unauthorized = new Set<string>();
    for (const tid of tableIds) {
        if (!authorized.has(tid)) unauthorized.add(tid);
    }
    return unauthorized;
}

/**
 * TICKET-077: is this spot pinnable for a LIVE handoff?
 *
 * A handoff pin may only target a restaurant_id that is in the share's CURRENT
 * live spot set (read server-side via loadLiveSpots). The client cannot smuggle a
 * restaurant_id the owner has since removed, or one belonging to a different
 * share. Live spots always carry a verified restaurant_id, so a null/unknown id
 * is non-live → not pinnable → NOT_IN_SHARE.
 *
 * `liveRestaurantIds === null` means there is NO handoff gate (a normal import);
 * every spot is pinnable. This helper is only consulted on the handoff path.
 */
export function isSpotPinnable(
    restaurantId: string | null | undefined,
    liveRestaurantIds: Set<string> | null,
): boolean {
    if (liveRestaurantIds === null) return true; // no handoff gate
    if (!restaurantId) return false;             // live spots always carry a real id
    return liveRestaurantIds.has(restaurantId);
}

/**
 * ROUND-3 FIX (Codex review): map external_id → restaurant_id for VERIFIED
 * rows only. Unverified rows must NOT be mapped: handing the client a
 * restaurant_id makes it drop external_id, which skips the save-time verified
 * upsert and strands the row unverified forever. Unmapped candidates flow the
 * external_id save path, whose ON CONFLICT (external_id) upsert promotes the
 * same row to verified with full Places metadata.
 */
export function mapVerifiedRestaurantIds(
    rows: Array<{ id: string; external_id: string | null; verification?: string | null }>,
): Map<string, string> {
    const map = new Map<string, string>();
    for (const row of rows) {
        if (row.external_id && row.verification === 'verified') {
            map.set(row.external_id, row.id);
        }
    }
    return map;
}

// ── TICKET-152: resolve_spots + pin_wishlist decision helpers ─────────────────
// These are the *decision* helpers only (pure, testable). The network-touching
// resolve core (staged → resolveCandidateToPlace in parallel → similarity gate)
// stays a shared function in index.ts — it cannot live here (no I/O in _helpers).

/** One item of a resolve_spots request, after validation + normalization. */
export interface ResolveSpotItem {
    name: string;
    address: string | null;
    client_nonce: string;
}

export type ResolveSpotsValidation =
    | { ok: true; items: ResolveSpotItem[] }
    | { ok: false; message: string };

/**
 * Validate + normalize a resolve_spots request body (TICKET-152).
 *
 * resolve_spots is a paid-Places amplifier, so the arg gates are strict and MUST
 * run FIRST — before the rate check and any Places call (L3). A malformed request
 * then 400s deterministically (the empty-items smoke relies on this) and never
 * burns an import_spots token.
 *
 * Gates, in order:
 *   1. import_nonce is a non-empty string (the job's importNonce — shape gate).
 *   2. items is an array of length 1..20 (hard cap === save_spots' per-request cap).
 *   3. every item carries a non-empty string name AND client_nonce — client_nonce
 *      is the deterministic echo-join key the client maps result→item by.
 * address is coerced to string | null (the full address rides into the Places query).
 */
export function validateResolveSpotsArgs(
    importNonce: unknown,
    items: unknown,
): ResolveSpotsValidation {
    if (typeof importNonce !== 'string' || importNonce.trim().length === 0) {
        return { ok: false, message: 'import_nonce is required' };
    }
    if (!Array.isArray(items) || items.length === 0) {
        return { ok: false, message: 'items[] must contain 1–20 entries' };
    }
    if (items.length > 20) {
        return { ok: false, message: 'items[] exceeds the 20-item cap' };
    }
    const normalized: ResolveSpotItem[] = [];
    for (const raw of items) {
        const item = (raw && typeof raw === 'object' && !Array.isArray(raw))
            ? raw as Record<string, unknown>
            : null;
        const name = item && typeof item['name'] === 'string' ? item['name'].trim() : '';
        const clientNonce = item && typeof item['client_nonce'] === 'string'
            ? item['client_nonce'].trim()
            : '';
        if (!name || !clientNonce) {
            return { ok: false, message: 'each item requires name and client_nonce' };
        }
        const address = item && typeof item['address'] === 'string' && item['address'].trim().length > 0
            ? item['address'].trim()
            : null;
        normalized.push({ name, address, client_nonce: clientNonce });
    }
    return { ok: true, items: normalized };
}

/**
 * Effective `pin_wishlist` for save_spots (TICKET-152). Default TRUE — only an
 * explicit boolean `false` disables the personal-wishlist pin (list-only import).
 * Anything else (absent, non-boolean) → true, so every existing caller that omits
 * the field keeps today's wishlist-pinning behavior byte-for-byte.
 */
export function normalizePinWishlist(raw: unknown): boolean {
    return raw === false ? false : true;
}

/**
 * The save path a pin_wishlist=false (list-only) spot takes (TICKET-152 M1):
 *   'existing' — a restaurant_id is already in hand (FIX#4 upsert / client-sent) → 'saved'.
 *   'verified' — a real external_id but no restaurant_id yet → upsert verified → 'saved'.
 *   'ghost'    — no external_id at all → mint a DETERMINISTIC unverified ghost row
 *                (buildGhostExternalId, keyed on (user, client_nonce)) so a list-only
 *                job never silently drops a spot and the lazy verify-on-open repair
 *                still fires → 'ghost'. A resume re-upserts the SAME row (ON CONFLICT
 *                external_id), so no dup.
 */
export function listOnlySaveKind(
    resolvedRestaurantId: string | null | undefined,
    safeExternalId: string | null | undefined,
): 'existing' | 'verified' | 'ghost' {
    if (resolvedRestaurantId) return 'existing';
    if (safeExternalId) return 'verified';
    return 'ghost';
}

/**
 * Kill-switch gate (TICKET-152): when env RESOLVE_SPOTS_GHOST_ONLY holds a truthy
 * value, resolve_spots short-circuits to { results: [], ghost_mode: true } with
 * ZERO Places calls — the "monthly Places spend cap hit" degradation lever, flipped
 * by the founder (there is no automatic spend meter). '0' / 'false' / 'off' / '' → off.
 */
export function isGhostOnlyMode(envValue: string | null | undefined): boolean {
    if (!envValue) return false;
    const v = envValue.trim().toLowerCase();
    return v !== '' && v !== '0' && v !== 'false' && v !== 'off';
}

// ── TICKET-187: save_spots photo-field quarantine ─────────────────────────────

import type { RestaurantInput } from '../_shared/restaurant.ts';

/**
 * Full place payload forwarded by the client for metadata-complete upserts
 * (fix-pass-2 item 3). TICKET-187: photoReference / photoAttributionHtml are
 * DELIBERATELY absent — the server never reads client photo fields. The hero
 * photo is acquired server-side, post-response, by the DB-derived external_id
 * (acquireAndMirrorHeroPhotos), so a client cannot pair a foreign photo with a
 * restaurant row.
 */
export interface SaveSpotPlacePayload {
    external_id?: string | null;
    name?: string | null;
    location?: { address?: string; locality?: string; country?: string };
    latitude?: number | null;
    longitude?: number | null;
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

/**
 * Build the verified-restaurant upsert input for a save_spots spot (TICKET-187).
 *
 * The ONE mapping both handleSaveSpots upsert sites (FIX#4 + the list-only
 * 'verified' branch) use — extracted so the deno test can assert the invariant
 * that closed the review finding: NO photo field (photoReference /
 * photoAttributionHtml) ever reaches upsertRestaurant from a client payload,
 * even a forged one. Zero Google calls happen on the save critical path; the
 * deferred acquireAndMirrorHeroPhotos job owns ALL photo work.
 */
export function buildVerifiedUpsertInput(
    externalId: string,
    spot: {
        restaurant_name?: string | null;
        restaurant_city?: string | null;
        place?: SaveSpotPlacePayload | null;
    },
): RestaurantInput {
    const p = spot.place;
    return {
        external_id: externalId,
        name: p?.name ?? spot.restaurant_name ?? 'Unknown',
        location: {
            address: p?.location?.address ?? undefined,
            locality: p?.location?.locality ?? spot.restaurant_city ?? undefined,
            country: p?.location?.country ?? undefined,
        },
        latitude: p?.latitude ?? undefined,
        longitude: p?.longitude ?? undefined,
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
    };
}

/**
 * Collect the DEDUPLICATED successful restaurant_ids from a save_spots result
 * list — the exact input the deferred photo job receives (TICKET-187). Failed
 * spots and rows without a restaurant_id are excluded; ghost/list-only rows may
 * pass through (they carry an id) — the job's verification filter skips them
 * before any rate token. Works identically for the request-supplied-
 * restaurant_id branch: the id is still known from the result row.
 */
export function dedupeSuccessfulRestaurantIds(
    results: Array<{ status: string; restaurant_id?: string | null }>,
): string[] {
    const ids = new Set<string>();
    for (const r of results) {
        if (r.status !== 'failed' && r.restaurant_id) ids.add(r.restaurant_id);
    }
    return [...ids];
}
