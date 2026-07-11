/**
 * snapshot.ts — pure builders + the live-read loader for handoff shares.
 *
 * loadLiveSpots:          (supabase, ownerId, listId|null) → live spots + sharer_name
 *                         + list_name. SINGLE source of truth for what a share shows
 *                         (TICKET-077). Reads the owner's CURRENT verified spots +
 *                         CURRENT ratings at view time — NOT a frozen blob.
 * buildSnapshotInput:     joined DB rows + rating map → spot list
 *                         (verified-only re-check + owner-rating enrichment;
 *                         shared by the wishlist AND list paths)
 * buildSnapshot:          rows (+ optional list name) → in-memory payload
 *                         (still used by loadLiveSpots to assemble the live shape;
 *                         no longer persisted — TICKET-077)
 * buildRenderContext:     payload → allowlisted HTML context (strips restaurant_id)
 * buildResolveCandidates: payload + already-ids + nonces → resolve response spots
 *
 * No serve(), no Deno.env — the pure builders are testable without a live server.
 * loadLiveSpots takes a supabase client param so it can be exercised against a
 * mock/fake; the verified-only filter + ordering + rating enrichment are the
 * security-critical pieces and are pure-fn-testable via buildSnapshotInput /
 * listShareOrder, which loadLiveSpots delegates to.
 *
 * TICKET-077 (live shares — supersedes TICKET-072's frozen doctrine):
 *   - The display payload reflects the owner's state at READ time, not create time.
 *   - Verified-only is PRESERVED: live read filters restaurants.verification='verified'.
 *   - render context still contains EXACTLY { sharer_name, list_name, created_at,
 *     spots[{name,city,cuisine,rating}] } and restaurant_id is stripped from HTML.
 *
 * TICKET-074 (shape carried forward):
 *   - The payload optionally carries `list_name` (per-list shares). The key is
 *     OMITTED for wishlist shares so wishlist payloads stay legacy-identical.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SnapshotSpot {
    restaurant_id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
    rating: number | null;
}

export interface WishlistShareSnapshot {
    sharer_name: string;
    /** TICKET-074: frozen list title for per-list shares. Omitted for wishlist shares. */
    list_name?: string;
    spots: SnapshotSpot[];
}

/** Allowlisted context for HTML render (Codex #6: no uuid in HTML). */
export interface RenderContext {
    sharer_name: string;
    /** TICKET-074: frozen list title; null → page titles fall back to "napkin". */
    list_name: string | null;
    created_at: string;
    spots: Array<{
        name: string;
        city: string | null;
        cuisine: string | null;
        rating: number | null;
    }>;
}

/** Joined row shape produced by both create-path queries (wishlist_items / list_entries → restaurants!inner). */
export interface JoinedSpotRow {
    restaurant_id: string;
    restaurant: {
        name: string;
        city?: string | null;
        cuisine?: string | null;
        verification?: string | null;
    };
}

export interface ResolveSpot {
    candidate_id: string;
    restaurant_id: string;
    restaurant: {
        id: string;
        name: string;
        city: string | null;
        cuisine: string | null;
        external_id: null;
    };
    confidence: 'high';
    sharer_rating: number | null;
    already_wishlisted: boolean;
}

/**
 * Result of a live share read (TICKET-077).
 *
 * `spots` carries restaurant_id (consumed by resolve nonce derivation + pin
 * validation; stripped before HTML). `list_name` is null for wishlist shares.
 * `null` from loadLiveSpots ⇒ the owner/list is gone (e.g. list deleted) ⇒ the
 * caller resolves to a tombstone / revoked, never a crash.
 */
export interface LiveSpots {
    sharer_name: string;
    list_name: string | null;
    spots: SnapshotSpot[];
}

/** Minimal supabase-js surface loadLiveSpots needs — keeps the loader mockable. */
export interface LiveSpotsClient {
    from: (table: string) => any;
}

/**
 * Result of the write-boundary handoff authorization (TICKET-077 fix-pass).
 *
 * `revoked: true` ⇒ the share is revoked, unknown, or points at a deleted/unowned
 * list NOW — every requested spot must fail (SHARE_REVOKED). `revoked: false`
 * carries the AUTHORITATIVE live set (`liveRestaurantIds`) and the owner's CURRENT
 * `sharerName`, both read as late as possible (after the revoke re-check), so the
 * per-spot pin decision can never authorize off a stale set.
 */
export type HandoffWriteAuthorization =
    | { revoked: true }
    | { revoked: false; liveRestaurantIds: Set<string>; sharerName: string };

// ── Builders ──────────────────────────────────────────────────────────────────

/**
 * Order params for the list-share row query (TICKET-074 fix-pass).
 *
 * Mirrors EXACTLY what the lists fn `get` action renders:
 *   ranked   → position  ASC  (the curated rank order)
 *   unranked → created_at DESC (most-recently-added first)
 *
 * The snapshot freezes spots in this order; resolve/share-page render the
 * spots array as-is, so this is the order the recipient sees.
 */
export function listShareOrder(
    ranked: boolean,
): { column: 'position' | 'created_at'; ascending: boolean } {
    return ranked
        ? { column: 'position', ascending: true }
        : { column: 'created_at', ascending: false };
}

/**
 * loadLiveSpots — read the owner's CURRENT verified spots + ratings for a share.
 *
 * This is the SINGLE source of truth for what a share shows (TICKET-077). The
 * public share-page, the in-app resolve, and the pin path all call this so they
 * cannot diverge. It reproduces the EXACT logic the old `handoff` create action
 * ran at freeze time — verified-only filter, list/wishlist ordering, owner-rating
 * enrichment, sharer_name from the live profile — but driven by (ownerId, listId)
 * at READ time instead of (caller) at WRITE time.
 *
 * Branches (only the row source forks; enrichment is one shared path):
 *   - listId === null → wishlist_items (deleted_at IS NULL, restaurant_id NOT NULL)
 *     joined to restaurants!inner verified, ordered created_at DESC.
 *     list_name = null.
 *   - listId !== null → the list (by id + owner_id; not-yours/missing → null),
 *     then list_entries joined to restaurants!inner verified, ordered via
 *     listShareOrder(ranked). list_name = the list's CURRENT title.
 *
 * Returns null when the owner/list is gone for a per-list share (the list row is
 * missing or no longer owned) so the caller can tombstone instead of crashing.
 * An EMPTY spot array is a valid result (a wishlist/list that currently has no
 * verified spots) — callers render an empty state, NOT a tombstone, unless the
 * list itself is gone.
 *
 * Verified-only is preserved live: restaurants.verification='verified' is filtered
 * in SQL AND re-checked in buildSnapshotInput (defence-in-depth). Unverified
 * ghosts never surface across users.
 */
export async function loadLiveSpots(
    supabase: LiveSpotsClient,
    ownerId: string,
    listId: string | null,
): Promise<LiveSpots | null> {
    let joinedRows: JoinedSpotRow[];
    let listName: string | null = null;

    if (listId !== null) {
        // Per-list share: confirm the list still exists AND is still owned by the
        // share owner. A deleted list, or one whose ownership changed, → null
        // (tombstone). No existence oracle is needed here (service-role read,
        // already gated behind a valid token).
        const { data: list, error: listErr } = await supabase
            .from('lists')
            .select('id, title, ranked')
            .eq('id', listId)
            .eq('owner_id', ownerId)
            .maybeSingle();

        if (listErr) throw listErr;
        if (!list) return null;

        listName = (list as any).title as string;

        // List entries joined to restaurants — verified-only, in the list's
        // rendered order (position ASC when ranked, created_at DESC when not).
        const order = listShareOrder((list as any).ranked === true);
        const { data: listRows, error: entriesErr } = await supabase
            .from('list_entries')
            .select(`
                restaurant_id,
                restaurant:restaurants!inner (
                    id,
                    name,
                    city,
                    cuisine,
                    verification
                )
            `)
            .eq('list_id', listId)
            .eq('restaurant.verification', 'verified')
            .order(order.column, { ascending: order.ascending });

        if (entriesErr) throw entriesErr;
        joinedRows = (listRows ?? []) as unknown as JoinedSpotRow[];
    } else {
        // Wishlist share: the owner's CURRENT verified pinned items.
        const { data: wishlistRows, error: wishlistErr } = await supabase
            .from('wishlist_items')
            .select(`
                restaurant_id,
                restaurant:restaurants!inner (
                    id,
                    name,
                    city,
                    cuisine,
                    verification
                )
            `)
            .eq('user_id', ownerId)
            .is('deleted_at', null)
            .not('restaurant_id', 'is', null)
            .eq('restaurant.verification', 'verified')
            .order('created_at', { ascending: false });

        if (wishlistErr) throw wishlistErr;
        joinedRows = (wishlistRows ?? []) as unknown as JoinedSpotRow[];
    }

    // Owner's most-recent rating per restaurant (one query, ORDER BY created_at
    // DESC → first row per restaurant_id wins). Empty rows → empty map → null
    // ratings. Skip the query entirely when there are no spots.
    const ratingMap = new Map<string, number>();
    const restaurantIds = joinedRows.map((r) => r.restaurant_id);
    if (restaurantIds.length > 0) {
        const { data: ratingRows, error: ratingErr } = await supabase
            .from('entries')
            .select('restaurant_id, rating, created_at')
            .eq('user_id', ownerId)
            .in('restaurant_id', restaurantIds)
            .not('rating', 'is', null)
            .order('created_at', { ascending: false });

        if (ratingErr) throw ratingErr;
        for (const row of (ratingRows ?? []) as any[]) {
            if (!ratingMap.has(row.restaurant_id)) {
                ratingMap.set(row.restaurant_id, row.rating as number);
            }
        }
    }

    // Owner's CURRENT display_name → sharer_name (first token).
    const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('user_id', ownerId)
        .maybeSingle();

    const displayName = (profile as any)?.display_name as string ?? '';
    const sharerName = displayName.split(' ')[0]?.trim() || displayName || 'someone';

    // Shared enrichment (verified-only re-check + owner-rating). Produces the
    // SnapshotSpot shape — same as the old frozen builder, now live.
    const spots = buildSnapshotInput(joinedRows, ratingMap);

    return { sharer_name: sharerName, list_name: listName, spots };
}

/**
 * loadHandoffWriteAuthorization — the SINGLE authoritative authorization read for
 * a handoff pin, performed as late as possible (at the write boundary).
 *
 * TICKET-077 fix-pass (TOCTOU): the pin path must NOT authorize off a live set
 * loaded early — between an early load and the write loop, the owner can remove a
 * spot, delete the list, or have a restaurant de-verified, leaving a stale set
 * that wrongly passes `isSpotPinnable`. This helper collapses revocation AND
 * current-membership/verification into one read taken immediately before the
 * write loop:
 *
 *   1. revoke re-check — re-read `revoked_at` for the token (the share row may
 *      have been revoked since any earlier existence check).
 *   2. live load — `loadLiveSpots(ownerId, listId)` for the CURRENT verified spot
 *      set + the owner's CURRENT sharer_name.
 *
 * Returns `{ revoked: true }` when the share is revoked/unknown OR the live load
 * returns null (list/owner gone) — the caller fails every spot SHARE_REVOKED.
 * An EMPTY live set is NOT revoked: it returns `{ revoked: false, liveRestaurantIds:∅ }`
 * so every requested spot fails NOT_IN_SHARE (no longer present), which matches the
 * "share still exists but has nothing pinnable right now" case.
 *
 * The supabase param is typed loosely (the read uses `.from(...).select(...).eq(...).maybeSingle()`
 * plus the loadLiveSpots chain) so the handler's service-role client and the test
 * fake both satisfy it.
 */
export async function loadHandoffWriteAuthorization(
    supabase: LiveSpotsClient,
    handoffToken: string,
): Promise<HandoffWriteAuthorization> {
    // 1. Revoke re-check at the write boundary (the share may have been revoked
    //    since any earlier existence check — close that window here).
    const { data: shareRow, error: shareErr } = await (supabase as any)
        .from('wishlist_shares')
        .select('owner_id, list_id, revoked_at')
        .eq('token', handoffToken)
        .maybeSingle();

    if (shareErr) throw shareErr;
    if (!shareRow || (shareRow as any).revoked_at !== null) {
        return { revoked: true };
    }

    // 2. The ONE authoritative live read — CURRENT verified spot set + sharer_name.
    //    null ⇒ the list/owner is gone ⇒ treat as revoked (points at nothing).
    const ownerId = (shareRow as any).owner_id as string;
    const listId = ((shareRow as any).list_id as string | null) ?? null;
    const live = await loadLiveSpots(supabase, ownerId, listId);
    if (!live) {
        return { revoked: true };
    }

    return {
        revoked: false,
        liveRestaurantIds: new Set(live.spots.map((s) => s.restaurant_id)),
        sharerName: live.sharer_name,
    };
}

/**
 * Map joined DB rows + the caller's rating map into the live spot shape.
 *
 * TICKET-074: this is the SHARED enrichment step for both sources
 * (wishlist_items and list_entries) — do not fork it per source.
 *
 * - Verified-only re-check (defence-in-depth: the SQL already filters
 *   restaurant.verification='verified'; rows that slip through are dropped).
 * - Owner-rating enrichment: ratingMap is keyed by restaurant_id and holds the
 *   caller's most-recent rating; misses become null.
 */
export function buildSnapshotInput(
    rows: JoinedSpotRow[],
    ratingMap: Map<string, number>,
): Array<{
    restaurant_id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
    rating: number | null;
}> {
    return rows
        .filter((r) => r.restaurant?.verification === 'verified')
        .map((r) => ({
            restaurant_id: r.restaurant_id,
            name: r.restaurant.name,
            city: r.restaurant.city ?? null,
            cuisine: r.restaurant.cuisine ?? null,
            rating: ratingMap.get(r.restaurant_id) ?? null,
        }));
}

/**
 * Build the frozen snapshot from wishlist/list + rating data.
 *
 * ARCH-REVIEW-2 #2: only include verified restaurant spots.
 * The caller is responsible for filtering to verification='verified' before
 * passing rows here (buildSnapshotInput does this). This function does NOT
 * re-check verification.
 *
 * sharerName: first token of the owner's CURRENT display_name (TICKET-077: read
 *   live by loadLiveSpots, not frozen at create time).
 * listName (TICKET-074): list title for per-list shares. null/empty → the key is
 *   omitted entirely (wishlist share — legacy-identical shape).
 *
 * TICKET-077: this is now the shared shape ASSEMBLER fed LIVE rows from
 * loadLiveSpots (resolve + share-page both call it) — nothing is persisted.
 */
export function buildSnapshot(
    sharerName: string,
    rows: Array<{
        restaurant_id: string;
        name: string;
        city: string | null;
        cuisine: string | null;
        rating: number | null;
    }>,
    listName?: string | null,
): WishlistShareSnapshot {
    const trimmedListName = typeof listName === 'string' ? listName.trim() : '';
    return {
        sharer_name: sharerName,
        ...(trimmedListName !== '' ? { list_name: trimmedListName } : {}),
        spots: rows.map((r) => ({
            restaurant_id: r.restaurant_id,
            name: r.name,
            city: r.city ?? null,
            cuisine: r.cuisine ?? null,
            rating: typeof r.rating === 'number' ? r.rating : null,
        })),
    };
}

/**
 * Build the allowlisted HTML render context from a share payload.
 * Strips restaurant_id so no UUID can reach the HTML (Codex #6).
 * list_name passes through (null for wishlist shares).
 */
export function buildRenderContext(
    snapshot: WishlistShareSnapshot,
    createdAt: string,
): RenderContext {
    return {
        sharer_name: snapshot.sharer_name,
        list_name: snapshot.list_name ?? null,
        created_at: createdAt,
        spots: snapshot.spots.map((s) => ({
            name: s.name,
            city: s.city,
            cuisine: s.cuisine,
            rating: s.rating,
        })),
    };
}

/**
 * Build the resolve candidates for the in-app receive screen.
 *
 * candidateIds: Map<restaurant_id, derived_client_nonce> (from deriveClientNonce).
 * alreadyWishlistedIds: Set of restaurant_ids already in the receiver's wishlist.
 */
export function buildResolveCandidates(
    snapshot: WishlistShareSnapshot,
    alreadyWishlistedIds: Set<string>,
    candidateIds: Map<string, string>,
): ResolveSpot[] {
    return snapshot.spots.map((spot) => ({
        candidate_id: candidateIds.get(spot.restaurant_id) ?? spot.restaurant_id,
        restaurant_id: spot.restaurant_id,
        restaurant: {
            id: spot.restaurant_id,
            name: spot.name,
            city: spot.city,
            cuisine: spot.cuisine,
            external_id: null,
        },
        confidence: 'high' as const,
        sharer_rating: spot.rating,
        already_wishlisted: alreadyWishlistedIds.has(spot.restaurant_id),
    }));
}
