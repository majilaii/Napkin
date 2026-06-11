/**
 * snapshot.ts — pure builders for the handoff frozen snapshot.
 *
 * buildSnapshotInput:     joined DB rows + rating map → builder input
 *                         (verified-only re-check + owner-rating enrichment;
 *                         shared by the wishlist AND list_id create paths — TICKET-074)
 * buildSnapshot:          rows (+ optional frozen list name) → frozen jsonb payload
 * buildRenderContext:     snapshot → allowlisted HTML context (strips restaurant_id)
 * buildResolveCandidates: snapshot + already-ids + nonces → resolve response spots
 *
 * No serve(), no Deno.env — fully testable without a live server.
 *
 * TICKET-072 Codex #3/#5/#6:
 *   - Snapshot is frozen at create time; later restaurant mutations do not alter it.
 *   - render context contains EXACTLY { sharer_name, list_name, created_at,
 *     spots[{name,city,cuisine,rating}] }
 *   - restaurant_id is stripped from the HTML render context.
 *
 * TICKET-074:
 *   - Snapshot optionally carries a frozen `list_name` (per-list shares).
 *     The key is OMITTED for wishlist shares so old snapshots and new wishlist
 *     snapshots are byte-identical in shape.
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
 * Map joined DB rows + the caller's rating map into buildSnapshot input.
 *
 * TICKET-074: this is the SHARED enrichment step for both create paths
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
 * sharerName: first token of display_name at share time (Codex #3/#5).
 * listName (TICKET-074): frozen list title for per-list shares. null/empty →
 * the key is omitted entirely (wishlist share — legacy-identical shape).
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
 * Build the allowlisted HTML render context from a snapshot row.
 * Strips restaurant_id so no UUID can reach the HTML (Codex #6).
 * list_name passes through (null for wishlist shares and pre-074 snapshots).
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
