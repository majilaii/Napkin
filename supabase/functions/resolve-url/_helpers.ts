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
    | 'vision';

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
