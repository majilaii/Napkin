/**
 * mapItems unit tests — TICKET-131 shared layer mappers.
 *
 * Pins the load-bearing rules:
 *  - logged spots map to olive "been" pins; coord-less spots are dropped
 *    (callers derive unmappable counts from the length delta)
 *  - been pins never carry entryId (they must render the teardrop + the
 *    directions-first peek, NOT the network variant)
 *  - network pins carry entryId/author/hasReview (avatar pin + network peek)
 *  - the cuisine filter trim-matches and applies to any layer; null = pass-through
 */
import {
    spotsToMapItems,
    networkPinsToMapItems,
    filterItemsByCuisine,
    mergeYourItems,
    peopleFromItems,
    matchPeople,
    filterByCheckedPeople,
    peopleChipLabel,
    peopleCountLine,
    discoverItemsFor,
    overlapToMapItems,
    mergeDiscoverItems,
    supperPinsToMapItems,
} from '../mapItems';
import type { SpotSummary } from '@/hooks/users/useUserSpots';
import type { NetworkMapItem } from '@/hooks/users/useNetworkMapPins';
import type { TableWishlistItem } from '@/hooks/wishlist/useTableWishlist';
import type { TableMapPin } from '@/hooks/tables/useTableMapPins';
import type { WishlistMapItem } from '../WishlistMapView';

function spot(over: Partial<SpotSummary> & { restaurant_id: string }): SpotSummary {
    return {
        name: 'Spot',
        city: 'Tokyo',
        country: 'Japan',
        cuisine: 'Japanese',
        price_level: 2,
        lat: 35.6,
        lng: 139.7,
        photo_url: null,
        visit_count: 1,
        avg_rating: 4,
        last_visited_at: '2026-07-01T00:00:00Z',
        ...over,
    };
}

function pin(over: Partial<NetworkMapItem> & { restaurant_id: string }): NetworkMapItem {
    return {
        name: 'Spot',
        city: 'Lisbon',
        cuisine: 'Portuguese',
        lat: 38.7,
        lng: -9.1,
        author: { id: 'u1', name: 'Clara', avatar: null },
        entry_id: 'e1',
        rating: 4.5,
        note: 'great bread',
        has_review: true,
        others_count: 2,
        ...over,
    };
}

describe('spotsToMapItems', () => {
    it('maps logged spots to olive "been" pins (no entryId)', () => {
        const items = spotsToMapItems([spot({ restaurant_id: 'a' })]);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            id: 'a',
            name: 'Spot',
            city: 'Tokyo',
            cuisine: 'Japanese',
            lat: 35.6,
            lng: 139.7,
            been: true,
        });
        expect(items[0].entryId).toBeUndefined();
    });

    it('drops coord-less spots (callers count them via the length delta)', () => {
        const spots = [
            spot({ restaurant_id: 'a' }),
            spot({ restaurant_id: 'b', lat: null, lng: null }),
            spot({ restaurant_id: 'c', lat: 1.0, lng: null }),
        ];
        const items = spotsToMapItems(spots);
        expect(items.map((i) => i.id)).toEqual(['a']);
        expect(spots.length - items.length).toBe(2); // the unmappable derivation
    });

    it('tolerates null/undefined input', () => {
        expect(spotsToMapItems(null)).toEqual([]);
        expect(spotsToMapItems(undefined)).toEqual([]);
    });
});

describe('networkPinsToMapItems', () => {
    it('maps the network wire shape to avatar-pin items (entryId present)', () => {
        const items = networkPinsToMapItems([pin({ restaurant_id: 'r1' })]);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            id: 'r1',
            entryId: 'e1',
            author: { id: 'u1', name: 'Clara', avatar: null },
            rating: 4.5,
            note: 'great bread',
            hasReview: true,
            othersCount: 2,
        });
        expect(items[0].been).toBeUndefined();
    });

    it('tolerates null/undefined input', () => {
        expect(networkPinsToMapItems(null)).toEqual([]);
        expect(networkPinsToMapItems(undefined)).toEqual([]);
    });
});

describe('mergeYourItems (TICKET-134 Your map)', () => {
    // A save (no `been`) and a been pin for the SAME restaurant id, plus disjoint ones.
    const save = (id: string): WishlistMapItem => ({
        id, name: `save ${id}`, city: 'London', cuisine: 'Thai', lat: 51.5, lng: -0.1,
    });
    const beenPin = (id: string): WishlistMapItem => spotsToMapItems([spot({ restaurant_id: id })])[0];

    it('both on: unions saved + been and dedupes with been winning', () => {
        const saves = [save('a'), save('shared')];
        const been = [beenPin('shared'), beenPin('c')];
        const merged = mergeYourItems(saves, been, { showSaved: true, showBeen: true });
        expect(merged.map((i) => i.id).sort()).toEqual(['a', 'c', 'shared']);
        // The shared id keeps the BEEN relationship (been wins → olive ring)
        // plus the been-side enrichment (#167 card meta + loved badge).
        expect(merged.find((i) => i.id === 'shared')).toMatchObject({
            been: true,
            myRating: 4,
            visitCount: 1,
        });
        // A save-only id has no `been` flag (terracotta ring).
        expect(merged.find((i) => i.id === 'a')?.been).toBeUndefined();
    });

    it('been wins the relationship but does NOT strip save-side enrichment (emoji, priceLevel fallback)', () => {
        // #167 pin grammar: bubble = emoji (list save) or cuisine glyph; the
        // been mapper never carries emoji, so a been-win must keep the save's
        // (TICKET-108 emoji-wins precedence) + fall back to its priceLevel.
        const listSave: WishlistMapItem = { ...save('shared'), emoji: '🥟', priceLevel: 3 };
        const beenSide = { ...beenPin('shared'), priceLevel: null };
        const merged = mergeYourItems([listSave], [beenSide], { showSaved: true, showBeen: true });
        expect(merged).toHaveLength(1);
        expect(merged[0]).toMatchObject({
            id: 'shared',
            been: true,       // relationship: been wins
            emoji: '🥟',      // save enrichment survives
            priceLevel: 3,    // been-side null → saved fallback
            myRating: 4,      // been enrichment rides along
        });
    });

    it('showSaved=false: only been pins', () => {
        const merged = mergeYourItems([save('a')], [beenPin('c')], { showSaved: false, showBeen: true });
        expect(merged.map((i) => i.id)).toEqual(['c']);
        expect(merged[0].been).toBe(true);
    });

    it('showBeen=false: only saved pins (no been flag)', () => {
        const merged = mergeYourItems([save('a')], [beenPin('c')], { showSaved: true, showBeen: false });
        expect(merged.map((i) => i.id)).toEqual(['a']);
        expect(merged[0].been).toBeUndefined();
    });

    it('both off: empty (hits the map empty-state branch)', () => {
        expect(mergeYourItems([save('a')], [beenPin('c')], { showSaved: false, showBeen: false })).toEqual([]);
    });

    it('empty inputs: empty out', () => {
        expect(mergeYourItems([], [], { showSaved: true, showBeen: true })).toEqual([]);
    });
});

describe('Discover people picker (TICKET-137)', () => {
    // Three network pins from two authors (Clara ×2, Thomas ×1) + one author-less
    // item (shouldn't happen on the network layer, but the helpers must tolerate it).
    const items: WishlistMapItem[] = [
        ...networkPinsToMapItems([
            pin({ restaurant_id: 'r1', author: { id: 'clara', name: 'Clara', avatar: null } }),
            pin({ restaurant_id: 'r2', author: { id: 'thomas', name: 'Thomas', avatar: 'a.png' } }),
            pin({ restaurant_id: 'r3', author: { id: 'clara', name: 'Clara', avatar: null } }),
        ]),
        // A stray author-less item (e.g. a been pin) — filter must drop it under an
        // active checked set, and peopleFromItems must ignore it.
        spotsToMapItems([spot({ restaurant_id: 'r4' })])[0],
    ];

    describe('peopleFromItems', () => {
        it('returns distinct authors sorted by name, ignoring author-less items', () => {
            expect(peopleFromItems(items)).toEqual([
                { id: 'clara', name: 'Clara', avatar: null },
                { id: 'thomas', name: 'Thomas', avatar: 'a.png' },
            ]);
        });
        it('is empty for no network authors', () => {
            expect(peopleFromItems([])).toEqual([]);
        });
        // TICKET-147 root cause: the pins arrive in recency order, so a first-seen
        // roster reshuffles under the open sheet and the row a tap lands on changes
        // identity ("only one ticks at a time"). The roster MUST be stable no matter
        // what order the pins come in.
        it('is STABLE: same authors in a different pin order → identical roster', () => {
            const a = networkPinsToMapItems([
                pin({ restaurant_id: 'r1', author: { id: 'u-zoe', name: 'Zoe', avatar: null } }),
                pin({ restaurant_id: 'r2', author: { id: 'u-ada', name: 'Ada', avatar: null } }),
                pin({ restaurant_id: 'r3', author: { id: 'u-mia', name: 'Mia', avatar: null } }),
            ]);
            // Same three authors, pins in the reverse (a fresh-recency) order.
            const b = networkPinsToMapItems([
                pin({ restaurant_id: 'r3', author: { id: 'u-mia', name: 'Mia', avatar: null } }),
                pin({ restaurant_id: 'r2', author: { id: 'u-ada', name: 'Ada', avatar: null } }),
                pin({ restaurant_id: 'r1', author: { id: 'u-zoe', name: 'Zoe', avatar: null } }),
            ]);
            expect(peopleFromItems(a)).toEqual(peopleFromItems(b));
            // …and the stable order is alphabetical, not pin order.
            expect(peopleFromItems(a).map((p) => p.name)).toEqual(['Ada', 'Mia', 'Zoe']);
        });
        it('breaks name ties on id so the order is total/deterministic', () => {
            const dupName = networkPinsToMapItems([
                pin({ restaurant_id: 'r1', author: { id: 'id-b', name: 'Sam', avatar: null } }),
                pin({ restaurant_id: 'r2', author: { id: 'id-a', name: 'sam', avatar: null } }),
            ]);
            expect(peopleFromItems(dupName).map((p) => p.id)).toEqual(['id-a', 'id-b']);
        });
    });

    describe('matchPeople (client-side search)', () => {
        const roster = peopleFromItems(items); // [Clara, Thomas]
        it('blank query = pass-through (same list)', () => {
            expect(matchPeople(roster, '')).toEqual(roster);
            expect(matchPeople(roster, '   ')).toEqual(roster);
        });
        it('case-insensitive substring match on name', () => {
            expect(matchPeople(roster, 'th').map((p) => p.name)).toEqual(['Thomas']);
            expect(matchPeople(roster, 'LAR').map((p) => p.name)).toEqual(['Clara']);
        });
        it('no match → empty', () => {
            expect(matchPeople(roster, 'zzz')).toEqual([]);
        });
    });

    describe('filterByCheckedPeople (EXCLUSIVE-include)', () => {
        it('empty set = everyone (pass-through, same array semantics)', () => {
            expect(filterByCheckedPeople(items, new Set())).toHaveLength(4);
        });
        it('one checked id shows ONLY that person, dropping author-less items', () => {
            expect(filterByCheckedPeople(items, new Set(['clara'])).map((i) => i.id)).toEqual(['r1', 'r3']);
        });
        it('multiple checked ids include exactly those people', () => {
            expect(
                filterByCheckedPeople(items, new Set(['clara', 'thomas'])).map((i) => i.id).sort(),
            ).toEqual(['r1', 'r2', 'r3']);
        });
    });

    describe('peopleChipLabel', () => {
        const people = peopleFromItems(items);
        it('empty set → "Everyone"', () => {
            expect(peopleChipLabel(new Set(), people)).toBe('Everyone');
        });
        it('one checked → that person\'s name', () => {
            expect(peopleChipLabel(new Set(['thomas']), people)).toBe('Thomas');
        });
        it('one checked but unknown id → "1 person" fallback', () => {
            expect(peopleChipLabel(new Set(['ghost']), people)).toBe('1 person');
        });
        it('more than one → "N people"', () => {
            expect(peopleChipLabel(new Set(['clara', 'thomas']), people)).toBe('2 people');
        });
    });

    describe('discoverItemsFor (shared map/count derivation)', () => {
        // Overlap fixture: one restaurant shared with the network (r2) + one only
        // the table saved (r9).
        const overlap: WishlistMapItem[] = [
            { id: 'r2', name: 'Shared', city: null, cuisine: null, lat: 1, lng: 1, overlap: { count: 2, tableId: 't', tableName: 'T', members: [] } },
            { id: 'r9', name: 'TableOnly', city: null, cuisine: null, lat: 2, lng: 2, overlap: { count: 3, tableId: 't', tableName: 'T', members: [] } },
        ];
        it('everyone = overlap ∪ network deduped, overlap winning shared ids', () => {
            const out = discoverItemsFor(items, overlap, new Set());
            expect(out.map((i) => i.id).sort()).toEqual(['r1', 'r2', 'r3', 'r4', 'r9']);
            expect(out.find((i) => i.id === 'r2')?.overlap).toBeTruthy(); // overlap won
        });
        it('non-empty checked set = network only (overlap pins hidden)', () => {
            const out = discoverItemsFor(items, overlap, new Set(['clara', 'thomas']));
            expect(out.map((i) => i.id).sort()).toEqual(['r1', 'r2', 'r3']);
            expect(out.every((i) => i.overlap == null)).toBe(true);
        });
        it('dedupes two followees on ONE restaurant in the checked branch (first/most-recent wins)', () => {
            const dup = networkPinsToMapItems([
                pin({ restaurant_id: 'r5', author: { id: 'clara', name: 'Clara', avatar: null } }),
                pin({ restaurant_id: 'r5', author: { id: 'thomas', name: 'Thomas', avatar: null } }),
            ]);
            const out = discoverItemsFor(dup, [], new Set(['clara', 'thomas']));
            expect(out).toHaveLength(1);
            expect(out[0].author?.id).toBe('clara'); // first occurrence kept
        });
    });

    describe('peopleCountLine (live count feedback)', () => {
        // `items` = 3 network pins (r1/r3 Clara, r2 Thomas) + 1 author-less spot.
        // The count is discoverItemsFor(...).length — the EXACT array the map
        // renders — so dedupe + everyone-mode overlap merge are included.
        it('empty set → "from everyone" over all network pins', () => {
            expect(peopleCountLine(items, [], new Set())).toBe('showing 4 places from everyone');
        });
        it('one person → "from 1 person" with that person\'s place count', () => {
            expect(peopleCountLine(items, [], new Set(['clara']))).toBe('showing 2 places from 1 person');
        });
        it('two people → "from 2 people"', () => {
            expect(peopleCountLine(items, [], new Set(['clara', 'thomas']))).toBe(
                'showing 3 places from 2 people',
            );
        });
        it('pluralizes a single place', () => {
            expect(peopleCountLine(items, [], new Set(['thomas']))).toBe('showing 1 place from 1 person');
        });
        it('everyone-mode counts the overlap merge exactly as the map renders it (review P2-a)', () => {
            const overlap: WishlistMapItem[] = [
                // r1 shared with network (merged, not double-counted); r9 table-only (adds one).
                { id: 'r1', name: 'A', city: null, cuisine: null, lat: 1, lng: 1, overlap: { count: 2, tableId: 't', tableName: 'T', members: [] } },
                { id: 'r9', name: 'B', city: null, cuisine: null, lat: 2, lng: 2, overlap: { count: 2, tableId: 't', tableName: 'T', members: [] } },
            ];
            const rendered = discoverItemsFor(items, overlap, new Set()).length; // 4 + 1
            expect(rendered).toBe(5);
            expect(peopleCountLine(items, overlap, new Set())).toBe('showing 5 places from everyone');
        });
        it('two followees on one restaurant → count matches the deduped rendered pins', () => {
            const dup = networkPinsToMapItems([
                pin({ restaurant_id: 'r5', author: { id: 'clara', name: 'Clara', avatar: null } }),
                pin({ restaurant_id: 'r5', author: { id: 'thomas', name: 'Thomas', avatar: null } }),
            ]);
            const checked = new Set(['clara', 'thomas']);
            expect(discoverItemsFor(dup, [], checked)).toHaveLength(1);
            expect(peopleCountLine(dup, [], checked)).toBe('showing 1 place from 2 people');
        });
        it('always equals the rendered discoverItems length (never lies vs the map)', () => {
            const checked = new Set(['clara']);
            const shown = discoverItemsFor(items, [], checked).length;
            expect(peopleCountLine(items, [], checked)).toContain(`showing ${shown} `);
        });
    });
});

describe('filterItemsByCuisine', () => {
    const items = [
        ...spotsToMapItems([
            spot({ restaurant_id: 'a', cuisine: 'Japanese' }),
            spot({ restaurant_id: 'b', cuisine: ' Japanese ' }), // trim-matched
            spot({ restaurant_id: 'c', cuisine: 'Italian' }),
            spot({ restaurant_id: 'd', cuisine: null }),
        ]),
        ...networkPinsToMapItems([pin({ restaurant_id: 'e', cuisine: 'Japanese' })]),
    ];

    it('null filter passes everything through (same array semantics)', () => {
        expect(filterItemsByCuisine(items, null)).toHaveLength(5);
    });

    it('trim-matches the active cuisine across layers', () => {
        const filtered = filterItemsByCuisine(items, 'Japanese');
        expect(filtered.map((i) => i.id).sort()).toEqual(['a', 'b', 'e']);
    });

    it('excludes null-cuisine items when a filter is set', () => {
        expect(filterItemsByCuisine(items, 'Italian').map((i) => i.id)).toEqual(['c']);
    });
});

// ── TICKET-138: overlap mappers ─────────────────────────────────────────────────

function overlapRestaurant(over: { id: string } & Partial<TableWishlistItem['restaurant']>) {
    return {
        name: `R ${over.id}`,
        address: null,
        city: 'Lisbon',
        country: 'Portugal',
        photo_url: null,
        cuisine: 'Portuguese',
        google_rating: null,
        price_level: 2,
        external_id: null,
        lat: 38.7,
        lng: -9.1,
        ...over,
    } as TableWishlistItem['restaurant'];
}

function overlapItem(
    id: string,
    count: number,
    over?: { members?: TableWishlistItem['members']; restaurant?: Partial<TableWishlistItem['restaurant']> },
): TableWishlistItem {
    return {
        restaurant: overlapRestaurant({ id, ...over?.restaurant }),
        count,
        members: over?.members ?? [
            { user_id: 'u1', display_name: 'Clara', avatar_url: null },
            { user_id: 'u2', display_name: 'Thomas', avatar_url: null },
        ],
    };
}

describe('overlapToMapItems (TICKET-138)', () => {
    it('drops count===1 at minCount:2, keeps it at minCount:1 (139 saved-layer single)', () => {
        const sources = [{ tableId: 't1', tableName: 'Supper Club', items: [overlapItem('a', 1)] }];
        expect(overlapToMapItems(sources, { minCount: 2 })).toEqual([]);

        const kept = overlapToMapItems(sources, { minCount: 1 });
        expect(kept).toHaveLength(1);
        expect(kept[0].overlap).toMatchObject({ count: 1, tableId: 't1', tableName: 'Supper Club' });
        expect(kept[0].overlap!.members).toHaveLength(2);
    });

    it('drops a restaurant with null lat/lng even at count>=2', () => {
        const sources = [
            {
                tableId: 't1',
                tableName: 'T',
                items: [
                    overlapItem('a', 3, { restaurant: { lat: null } }),
                    overlapItem('b', 4, { restaurant: { lng: null } }),
                    overlapItem('c', 2),
                ],
            },
        ];
        expect(overlapToMapItems(sources, { minCount: 2 }).map((i) => i.id)).toEqual(['c']);
    });

    it('multi-table: MAX-COUNT table wins per restaurant (A=2, B=4 → B, count 4)', () => {
        const sources = [
            { tableId: 'A', tableName: 'Table A', items: [overlapItem('shared', 2)] },
            { tableId: 'B', tableName: 'Table B', items: [overlapItem('shared', 4)] },
        ];
        const items = overlapToMapItems(sources, { minCount: 2 });
        expect(items).toHaveLength(1);
        expect(items[0].overlap).toMatchObject({ count: 4, tableId: 'B', tableName: 'Table B' });
    });

    it('ties keep the FIRST source (sources iterate in order)', () => {
        const sources = [
            { tableId: 'A', tableName: 'Table A', items: [overlapItem('shared', 3)] },
            { tableId: 'B', tableName: 'Table B', items: [overlapItem('shared', 3)] },
        ];
        expect(overlapToMapItems(sources, { minCount: 2 })[0].overlap!.tableId).toBe('A');
    });

    it('me-inclusive: the server count passes through unchanged (mapper never recomputes)', () => {
        // count already includes the caller — the mapper trusts it verbatim.
        const sources = [{ tableId: 't1', tableName: 'T', items: [overlapItem('a', 3)] }];
        const items = overlapToMapItems(sources, { minCount: 2 });
        expect(items[0].overlap!.count).toBe(3);
        // No relationship flags leak onto an overlap item.
        expect(items[0].been).toBeUndefined();
        expect(items[0].entryId).toBeUndefined();
        expect(items[0].emoji).toBeUndefined();
        expect(items[0].priceLevel).toBe(2); // restaurant.price_level rides along for the $$ token
    });

    it('tolerates empty sources', () => {
        expect(overlapToMapItems([], { minCount: 2 })).toEqual([]);
    });
});

describe('mergeDiscoverItems (TICKET-138 overlap-beats-network dedupe)', () => {
    const overlap = overlapToMapItems(
        [{ tableId: 't1', tableName: 'T', items: [overlapItem('shared', 3), overlapItem('overlapOnly', 2)] }],
        { minCount: 2 },
    );
    const network = networkPinsToMapItems([
        pin({ restaurant_id: 'shared' }),
        pin({ restaurant_id: 'networkOnly' }),
    ]);

    it('a restaurant in both → one item, overlap wins (overlap != null, entryId == null)', () => {
        const merged = mergeDiscoverItems(overlap, network);
        const shared = merged.filter((i) => i.id === 'shared');
        expect(shared).toHaveLength(1);
        expect(shared[0].overlap).not.toBeNull();
        expect(shared[0].entryId).toBeUndefined();
    });

    it('network-only and overlap-only both survive', () => {
        const merged = mergeDiscoverItems(overlap, network);
        expect(merged.map((i) => i.id).sort()).toEqual(['networkOnly', 'overlapOnly', 'shared']);
        expect(merged.find((i) => i.id === 'networkOnly')?.entryId).toBe('e1');
        expect(merged.find((i) => i.id === 'overlapOnly')?.overlap).not.toBeNull();
    });
});

// ── TICKET-139: been-together mapper ────────────────────────────────────────────

function mapPin(over: Partial<TableMapPin> & { restaurant_id: string }): TableMapPin {
    return {
        name: 'Kono',
        city: 'Tokyo',
        cuisine: 'Japanese',
        lat: 35.6,
        lng: 139.7,
        supper_id: 's1',
        gathered_on: '2026-06-12T00:00:00Z',
        participants: [
            { user_id: 'u1', display_name: 'Clara', avatar_url: null },
            { user_id: 'u2', display_name: 'Thomas', avatar_url: 'a.png' },
        ],
        suppers_count: 1,
        ...over,
    };
}

describe('supperPinsToMapItems (TICKET-139)', () => {
    it('maps a been-together row to an olive been pin carrying gathered (no entryId/myRating)', () => {
        const items = supperPinsToMapItems([mapPin({ restaurant_id: 'r1' })]);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            id: 'r1',
            name: 'Kono',
            city: 'Tokyo',
            cuisine: 'Japanese',
            lat: 35.6,
            lng: 139.7,
            been: true,
        });
        expect(items[0].gathered).toMatchObject({ on: '2026-06-12T00:00:00Z', suppersCount: 1 });
        expect(items[0].entryId).toBeUndefined();
        expect(items[0].myRating).toBeUndefined();
    });

    it('preserves the ≤5 participant array (server already caps; mapper does not re-cap)', () => {
        const five = [1, 2, 3, 4, 5].map((n) => ({
            user_id: `u${n}`,
            display_name: `M${n}`,
            avatar_url: null,
        }));
        const items = supperPinsToMapItems([mapPin({ restaurant_id: 'r1', participants: five })]);
        expect(items[0].gathered!.participants).toHaveLength(5);
        expect(items[0].gathered!.participants.map((p) => p.user_id)).toEqual([
            'u1', 'u2', 'u3', 'u4', 'u5',
        ]);
    });

    it('carries the server-collapsed most-recent row through (gathered_on + suppers_count for "×N")', () => {
        // The server collapses repeat visits to one row (most-recent wins) and
        // reports suppers_count; the mapper surfaces both verbatim.
        const items = supperPinsToMapItems([
            mapPin({ restaurant_id: 'r1', gathered_on: '2026-07-01T00:00:00Z', suppers_count: 3 }),
        ]);
        expect(items[0].gathered).toMatchObject({ on: '2026-07-01T00:00:00Z', suppersCount: 3 });
    });

    it('overlapToMapItems at minCount:1 keeps a count===1 single (139 saved-layer shared path)', () => {
        // The 139 saved layer reuses 138's mapper at minCount:1 — a single-saver
        // restaurant survives with overlap.count===1 and its one member.
        const sources = [
            {
                tableId: 't1',
                tableName: 'Supper Club',
                items: [
                    {
                        restaurant: {
                            id: 'solo',
                            name: 'Solo Spot',
                            address: null,
                            city: 'Tokyo',
                            country: 'Japan',
                            photo_url: null,
                            cuisine: 'Japanese',
                            google_rating: null,
                            price_level: 2,
                            external_id: null,
                            lat: 35.6,
                            lng: 139.7,
                        },
                        count: 1,
                        members: [{ user_id: 'u1', display_name: 'Clara', avatar_url: null }],
                    },
                ],
            },
        ];
        const items = overlapToMapItems(sources, { minCount: 1 });
        expect(items).toHaveLength(1);
        expect(items[0].overlap).toMatchObject({ count: 1 });
        expect(items[0].overlap!.members).toHaveLength(1);
    });

    it('tolerates null/undefined input', () => {
        expect(supperPinsToMapItems(null)).toEqual([]);
        expect(supperPinsToMapItems(undefined)).toEqual([]);
    });
});
