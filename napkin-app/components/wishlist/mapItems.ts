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
import type { TableMapPin } from '@/hooks/tables/useTableMapPins';
import type { WishlistMapItem } from './WishlistMapView';
import {
    matchesFacets,
    type FacetRow,
    type MapFilters,
} from './mapFacets';

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

/** Project one aggregate Table-wishlist row into the shared facet shape. */
export function tableRowFacetView(item: TableWishlistItem): FacetRow {
    return {
        cuisine: item.restaurant.cuisine,
        city: item.restaurant.city,
        priceLevel: item.restaurant.price_level,
    };
}

/** Filter source rows before coordinate-less rows are partitioned from pins. */
export function filterTableWishlistRows(
    rows: readonly TableWishlistItem[],
    filters: MapFilters,
): TableWishlistItem[] {
    return rows.filter((row) => matchesFacets(tableRowFacetView(row), filters));
}

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

// ── Table been-together layer (TICKET-139) ──────────────────────────────────────

/**
 * Been-together rows (table-atlas?action=map_pins — the table's suppers + legacy
 * rounds, one row per restaurant, most-recent group meal winning) → olive `been`
 * pins carrying `gathered` for the peek. No new BubblePin variant: olive ring +
 * cuisine glyph is the existing been rendering; only the peek branches on
 * `gathered`. The RPC guarantees non-null coords, so no coord filter. No
 * `entryId`, no `myRating` (so no loved heart), no `photo_url`. Pure.
 */
export function supperPinsToMapItems(rows: TableMapPin[] | null | undefined): WishlistMapItem[] {
    return (rows ?? []).map((row) => ({
        id: row.restaurant_id,
        name: row.name,
        city: row.city,
        cuisine: row.cuisine,
        lat: row.lat,
        lng: row.lng,
        been: true,
        gathered: {
            tableId: row.table_id,
            on: row.gathered_on,
            participants: row.participants,
            suppersCount: row.suppers_count,
        },
    }));
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
 * follow who has pins").
 *
 * STABLE ORDER (TICKET-147). Network pins arrive in the RPC's recency order
 * (`ORDER BY sort_date DESC`), so a first-seen roster would re-rank whenever a
 * followee logs a meal — people jumping between sessions. Dedupe, then sort by
 * name (case-insensitive) with an id tiebreak: deterministic regardless of pin
 * order. (This is a UX/robustness win, NOT the multi-select fix — the cold
 * review showed row order was already referentially stable across a tapping
 * session; the multi-select mechanism is killed by the sheet's draft-apply.)
 */
export function peopleFromItems(items: WishlistMapItem[]): DiscoverPerson[] {
    const seen = new Map<string, DiscoverPerson>();
    for (const it of items) {
        const a = it.author;
        if (a && !seen.has(a.id)) seen.set(a.id, { id: a.id, name: a.name, avatar: a.avatar });
    }
    return [...seen.values()].sort((a, b) => {
        const an = a.name.trim().toLowerCase();
        const bn = b.name.trim().toLowerCase();
        if (an < bn) return -1;
        if (an > bn) return 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/**
 * Client-side people search (TICKET-147) — case-insensitive name substring
 * match. Empty/blank query = pass-through. Pure so the picker's search is
 * unit-tested; the sheet only owns the query string.
 */
export function matchPeople(people: DiscoverPerson[], query: string): DiscoverPerson[] {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => p.name.toLowerCase().includes(q));
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

/**
 * The Discover layer derivation — ONE source of truth shared by the map (the
 * items it renders) and `peopleCountLine` (the picker's narration), so the two
 * can never disagree (TICKET-147 review P2-a).
 *
 * Empty checked set = everyone: network ∪ table-overlap merged one marker per
 * restaurant (overlap wins — `mergeDiscoverItems`). A non-empty exclusive-
 * include shows ONLY those people's network pins (a table overlap bubble would
 * break the "only these people" promise — TICKET-138), deduped by restaurant id
 * (first occurrence wins: network rows arrive most-recent-first, mirroring the
 * RPC's rn=1 primary-author rule). The RPC already emits one row per restaurant,
 * so that dedupe is belt-and-braces — but it keeps the map's "never two items
 * for one id" invariant true by construction for any input.
 */
export function discoverItemsFor(
    networkItems: WishlistMapItem[],
    overlapItems: WishlistMapItem[],
    checkedIds: ReadonlySet<string>,
): WishlistMapItem[] {
    if (checkedIds.size === 0) return mergeDiscoverItems(overlapItems, networkItems);
    const byId = new Map<string, WishlistMapItem>();
    for (const it of filterByCheckedPeople(networkItems, checkedIds)) {
        if (!byId.has(it.id)) byId.set(it.id, it);
    }
    return [...byId.values()];
}

/**
 * The picker's live count line (TICKET-147): `showing N places from everyone` /
 * `showing N places from 2 people`. The place count is `discoverItemsFor(...)`
 * .length — the EXACT array the map renders (restaurant-id dedupe + everyone-
 * mode overlap merge included), so the number can never lie against the pins.
 * `who` pluralizes: `everyone` (empty set) · `1 person` · `N people`. Pure;
 * unit-tested.
 */
export function peopleCountLine(
    networkItems: WishlistMapItem[],
    overlapItems: WishlistMapItem[],
    checkedIds: ReadonlySet<string>,
): string {
    const places = discoverItemsFor(networkItems, overlapItems, checkedIds).length;
    // Who-count = checked ids that are VISIBLE people (authors of actual pins).
    // A draft carrying a pin-less id must not inflate the label — "from 2
    // people" when one is invisible is a lie (founder repro, 2026-07-09).
    const authorIds = new Set(
        networkItems.map((it) => it.author?.id).filter((id): id is string => id != null),
    );
    const visible = [...checkedIds].filter((id) => authorIds.has(id)).length;
    const who = checkedIds.size === 0 ? 'everyone' : visible === 1 ? '1 person' : `${visible} people`;
    return `showing ${places} ${places === 1 ? 'place' : 'places'} from ${who}`;
}

/**
 * "Your table" picker rows (TICKET-139). Effective roster = member ids MINUS the
 * viewer (their own pins aren't in Discover) INTERSECTED with the visible people
 * (pin authors). Rows render when that set has ≥1 person (founder call
 * 2026-07-09): the ≥2 de-alias gate (PR #183) made a table vanish from the picker
 * whenever only one tablemate had pins, reading as a removed feature. With
 * draft-apply already killing the dropped-tap multi-select bug, the only residue
 * of the single-member case is a cosmetic double-check (the table row and that
 * one person's row both light) — acceptable to keep the table always reachable
 * as long as any member is visible. The 0-visible case stays hidden: selecting it
 * would filter to nothing. Pure; unit-tested.
 */
export function buildTableRows(
    raw: { tableId: string; name: string; memberIds: string[] }[],
    selfId: string | null | undefined,
    people: DiscoverPerson[],
): { tableId: string; name: string; memberIds: string[] }[] {
    const peopleIds = new Set(people.map((p) => p.id));
    return raw
        .map((r) => ({
            ...r,
            memberIds: [...new Set(r.memberIds)].filter(
                (id) => id !== selfId && peopleIds.has(id),
            ),
        }))
        .filter((r) => r.memberIds.length >= 1);
}
