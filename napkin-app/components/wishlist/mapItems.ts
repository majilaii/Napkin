/**
 * mapItems — pure mappers from the map data hooks' wire shapes to
 * WishlistMapItem (TICKET-131).
 *
 * Extracted from dining-map.tsx so BOTH map consumers (the wishlist tab's
 * Saved · Been · Network layers and /dining-map's Mine · Network toggle) share
 * one mapping. No I/O, no React, no native — type-only imports keep this
 * jest-safe (same pattern as mapPinsUtils / filterTabsUtils).
 *
 * Layer grammar (one map surface grammar, both screens):
 *  - logged spots (useUserSpots)      → olive teardrops (`been: true`)
 *  - network pins (useNetworkMapPins) → avatar pins (presence of `entryId`)
 *  - wishlist saves stay terracotta teardrops via buildMapPins (not here).
 */
import type { SpotSummary } from '@/hooks/users/useUserSpots';
import type { NetworkMapItem } from '@/hooks/users/useNetworkMapPins';
import type { TableWishlistItem } from '@/hooks/wishlist/useTableWishlist';
import type { WishlistMapItem } from './WishlistMapView';

/**
 * Logged spots → olive "been" pins. Coord-less spots are dropped (the caller
 * derives its unmappable count as `spots.length - items.length` when needed).
 */
export function spotsToMapItems(spots: SpotSummary[] | null | undefined): WishlistMapItem[] {
    return (spots ?? [])
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => ({
            id: s.restaurant_id,
            name: s.name,
            city: s.city,
            cuisine: s.cuisine,
            lat: s.lat!,
            lng: s.lng!,
            been: true,
            // Peek-card + pin enrichment (map-card-pin pass, 2026-07-08):
            // $$ meta, rating numeral + loved-heart badge, visit count.
            // Deliberately NO photo: SpotSummary.photo_url mirrors
            // restaurants.photo_url = a Places hero photo (banned surface).
            priceLevel: s.price_level,
            myRating: s.avg_rating,
            visitCount: s.visit_count,
        }));
}

/**
 * Follow-graph pins → avatar pins. The RPC guarantees non-null coords, so no
 * coord filter; `entryId` presence is what flips the pin + peek to the network
 * variant downstream.
 */
export function networkPinsToMapItems(pins: NetworkMapItem[] | null | undefined): WishlistMapItem[] {
    return (pins ?? []).map((p) => ({
        id: p.restaurant_id,
        name: p.name,
        city: p.city,
        cuisine: p.cuisine,
        lat: p.lat,
        lng: p.lng,
        author: p.author,
        rating: p.rating,
        note: p.note,
        entryId: p.entry_id,
        hasReview: p.has_review,
        othersCount: p.others_count,
    }));
}

/**
 * TICKET-134 "Your map" merge: saved (terracotta ring) + been (olive ring) pins
 * on one surface, each gated by a filter toggle. Dedupe by restaurant `id` with
 * BEEN WINNING the relationship — you've been there is a stronger signal than a
 * save, so the deduped pin keeps `been: true` (+ myRating/visitCount for the
 * #167 loved-heart badge and card meta). Pure; unit-tested (AC8).
 *
 * MERGE, don't overwrite (#167 pin grammar reads more than the relationship):
 * save-side enrichment the been mapper doesn't carry survives the dedupe — the
 * owning-list emoji (TICKET-108 "emoji wins" precedence: the bubble shows it
 * over the cuisine glyph) and a priceLevel fallback for the card's $$ token.
 *
 * @param saves  buildMapPins output (wishlist ∪ list saves; no `been`)
 * @param been   spotsToMapItems output (logged spots; `been: true` + enrichment)
 */
export function mergeYourItems(
    saves: WishlistMapItem[],
    been: WishlistMapItem[],
    opts: { showSaved: boolean; showBeen: boolean },
): WishlistMapItem[] {
    const byId = new Map<string, WishlistMapItem>();
    if (opts.showSaved) {
        for (const s of saves) byId.set(s.id, s);
    }
    // Been applied AFTER saves so a restaurant in both takes the been fields
    // (been:true → olive ring). Map preserves first-insertion order, which is
    // fine on a map (position, not order, is the signal).
    if (opts.showBeen) {
        for (const b of been) {
            const prior = byId.get(b.id);
            byId.set(
                b.id,
                prior
                    ? {
                          ...prior,
                          ...b,
                          emoji: b.emoji ?? prior.emoji ?? null,
                          priceLevel: b.priceLevel ?? prior.priceLevel ?? null,
                      }
                    : b,
            );
        }
    }
    return [...byId.values()];
}

/**
 * Cuisine filter for the been/network layers (TICKET-131): the FilterTabsSheet's
 * cuisine selection applies to whichever layer is active. Trim-matched, mirroring
 * buildMapPins' matchesFilters semantics. Null filter → pass-through.
 */
export function filterItemsByCuisine(
    items: WishlistMapItem[],
    cuisine: string | null,
): WishlistMapItem[] {
    if (!cuisine) return items;
    return items.filter((i) => (i.cuisine?.trim() ?? '') === cuisine);
}

// ── Table overlap layer (TICKET-138) ────────────────────────────────────────────
// A restaurant saved by ≥ minCount members of one of the viewer's tables becomes
// an amber count bubble ("N of you saved this"). The `count` is server-authoritative
// (member-gated, table-inclusive — computed by wishlist?action=list_table), so the
// mapper never recomputes it.

/**
 * Table overlap rows → amber count-bubble items. Merges across the viewer's tables:
 * MAX-COUNT table wins per restaurant (tie → first source, since sources iterate in
 * order and only a STRICTLY greater count replaces the prior). Drops coord-less
 * restaurants and rows below `minCount` (TICKET-138 Discover → 2; TICKET-139 saved
 * layer → 1, where a count===1 single renders as a plain terracotta save bubble).
 * Pure; unit-tested.
 */
export function overlapToMapItems(
    sources: { tableId: string; tableName: string; items: TableWishlistItem[] }[],
    opts: { minCount: number },
): WishlistMapItem[] {
    const byId = new Map<string, WishlistMapItem>();
    for (const src of sources) {
        for (const it of src.items) {
            if (it.count < opts.minCount) continue;
            const r = it.restaurant;
            if (r?.lat == null || r?.lng == null) continue;
            const prior = byId.get(r.id);
            if (prior && (prior.overlap?.count ?? 0) >= it.count) continue; // keep max; tie → first
            byId.set(r.id, {
                id: r.id,
                name: r.name,
                city: r.city,
                cuisine: r.cuisine,
                lat: r.lat,
                lng: r.lng,
                priceLevel: r.price_level ?? null,
                overlap: {
                    count: it.count,
                    tableId: src.tableId,
                    tableName: src.tableName,
                    members: it.members,
                },
            });
        }
    }
    return [...byId.values()];
}

/**
 * Discover dedupe: overlap WINS over network per restaurant id (one marker per
 * restaurant; overlap is the rarer/stronger signal — AC4). Seed with network,
 * overwrite with overlap. Pure — the render never sees two items for one id.
 */
export function mergeDiscoverItems(
    overlap: WishlistMapItem[],
    network: WishlistMapItem[],
): WishlistMapItem[] {
    const byId = new Map<string, WishlistMapItem>();
    for (const n of network) byId.set(n.id, n);
    for (const o of overlap) byId.set(o.id, o); // overlap wins
    return [...byId.values()];
}

// ── Discover people picker (TICKET-137) ────────────────────────────────────────
// The old friend rail ("toggle a face off to hide it") is replaced by an
// EXCLUSIVE-include picker: an empty checked set = everyone; any checked ids show
// ONLY those people's pins. Pure so the semantics are unit-tested.

export interface DiscoverPerson {
    id: string;
    name: string;
    avatar: string | null;
}

/**
 * Distinct authors across the network layer — the picker's roster ("everyone you
 * follow who has pins"). First-seen order; deterministic.
 */
export function peopleFromItems(items: WishlistMapItem[]): DiscoverPerson[] {
    const seen = new Map<string, DiscoverPerson>();
    for (const it of items) {
        const a = it.author;
        if (a && !seen.has(a.id)) seen.set(a.id, { id: a.id, name: a.name, avatar: a.avatar });
    }
    return [...seen.values()];
}

/**
 * EXCLUSIVE-include filter: empty set → everyone (pass-through); otherwise only
 * pins whose author is checked. (NOT the old "toggle off to hide" model.)
 */
export function filterByCheckedPeople(
    items: WishlistMapItem[],
    checkedIds: ReadonlySet<string>,
): WishlistMapItem[] {
    if (checkedIds.size === 0) return items;
    return items.filter((it) => it.author != null && checkedIds.has(it.author.id));
}

/**
 * The people-chip label: `Everyone` (default) · the one checked person's name ·
 * `N people` when more than one is checked. Copy economy (TICKET-137).
 */
export function peopleChipLabel(
    checkedIds: ReadonlySet<string>,
    people: DiscoverPerson[],
): string {
    if (checkedIds.size === 0) return 'Everyone';
    if (checkedIds.size === 1) {
        const [only] = [...checkedIds];
        return people.find((p) => p.id === only)?.name ?? '1 person';
    }
    return `${checkedIds.size} people`;
}
