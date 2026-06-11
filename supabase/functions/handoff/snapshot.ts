/**
 * snapshot.ts — pure builders for the handoff frozen snapshot.
 *
 * buildSnapshot:          wishlist rows + ratings → frozen jsonb payload
 * buildRenderContext:     snapshot → allowlisted HTML context (strips restaurant_id)
 * buildResolveCandidates: snapshot + already-ids + nonces → resolve response spots
 *
 * No serve(), no Deno.env — fully testable without a live server.
 *
 * TICKET-072 Codex #3/#5/#6:
 *   - Snapshot is frozen at create time; later restaurant mutations do not alter it.
 *   - render context contains EXACTLY { sharer_name, created_at, spots[{name,city,cuisine,rating}] }
 *   - restaurant_id is stripped from the HTML render context.
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
    spots: SnapshotSpot[];
}

/** Allowlisted context for HTML render (Codex #6: no uuid in HTML). */
export interface RenderContext {
    sharer_name: string;
    created_at: string;
    spots: Array<{
        name: string;
        city: string | null;
        cuisine: string | null;
        rating: number | null;
    }>;
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
 * Build the frozen snapshot from wishlist + rating data.
 *
 * ARCH-REVIEW-2 #2: only include verified restaurant spots.
 * The caller is responsible for filtering to verification='verified' before
 * passing rows here. This function does NOT re-check verification.
 *
 * sharerName: first token of display_name at share time (Codex #3/#5).
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
): WishlistShareSnapshot {
    return {
        sharer_name: sharerName,
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
 */
export function buildRenderContext(
    snapshot: WishlistShareSnapshot,
    createdAt: string,
): RenderContext {
    return {
        sharer_name: snapshot.sharer_name,
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
