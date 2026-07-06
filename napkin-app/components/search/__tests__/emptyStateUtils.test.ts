/**
 * Tests for components/search/emptyStateUtils.ts (TICKET-097).
 * Pure selectors: nearest-pinned selection + client-side list matching.
 */
import { selectNearbyPinned, filterListsByQuery } from '../emptyStateUtils';
import type {
    PersonalWishlistItem,
    WishlistRestaurant,
} from '@/hooks/wishlist/useMyWishlist';
import type { MyList } from '@/hooks/lists/useMyLists';

// ── Fixtures ─────────────────────────────────────────────────────────────────

// Union Square-ish origin; latitude degrees ≈ 69 mi.
const ORIGIN = { latitude: 40.7359, longitude: -73.9911 };

function wishItem(
    overrides: Partial<WishlistRestaurant> & { id: string },
    itemOverrides: Partial<PersonalWishlistItem> = {},
): PersonalWishlistItem {
    return {
        id: `wl-${overrides.id}`,
        note: null,
        created_at: '2026-07-01T00:00:00Z',
        source: null,
        restaurant: {
            id: overrides.id,
            name: overrides.name ?? `Spot ${overrides.id}`,
            address: overrides.address ?? null,
            city: overrides.city ?? 'New York',
            country: null,
            photo_url: overrides.photo_url ?? null,
            cuisine: overrides.cuisine ?? null,
            google_rating: null,
            price_level: null,
            external_id: overrides.external_id ?? null,
            lat: 'lat' in overrides ? overrides.lat : ORIGIN.latitude,
            lng: 'lng' in overrides ? overrides.lng : ORIGIN.longitude,
        },
        ...itemOverrides,
    };
}

function list(id: string, title: string, description: string | null = null): MyList {
    return {
        id,
        owner_id: 'u1',
        title,
        description,
        ranked: false,
        privacy: 'public',
        emoji: null,
        entry_count: 3,
        cover_photo_url: null,
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
    };
}

// ── selectNearbyPinned ───────────────────────────────────────────────────────

describe('selectNearbyPinned', () => {
    it('returns [] without coords — section absent, never a nag', () => {
        expect(selectNearbyPinned([wishItem({ id: 'a' })], null)).toEqual([]);
    });

    it('sorts nearest first and caps at 6', () => {
        // Each 0.01° of latitude ≈ 0.69 mi; build 8 spots at increasing distance.
        const items = Array.from({ length: 8 }, (_, i) =>
            wishItem({ id: `r${i}`, lat: ORIGIN.latitude + 0.01 * (8 - i) }),
        );
        const result = selectNearbyPinned(items, ORIGIN);

        expect(result).toHaveLength(6);
        expect(result.map((r) => r.row.id)).toEqual(['r7', 'r6', 'r5', 'r4', 'r3', 'r2']);
        const dists = result.map((r) => parseFloat(r.distanceLabel));
        expect([...dists].sort((a, b) => a - b)).toEqual(dists);
    });

    it('drops rows without a restaurant or without coords', () => {
        const noRestaurant: PersonalWishlistItem = {
            ...wishItem({ id: 'x' }),
            restaurant: null,
        };
        const noCoords = wishItem({ id: 'b', lat: null, lng: null });
        const good = wishItem({ id: 'a' });

        const result = selectNearbyPinned([noRestaurant, noCoords, good], ORIGIN);
        expect(result.map((r) => r.row.id)).toEqual(['a']);
    });

    it('drops pending / needs_confirm captures', () => {
        const pending = wishItem({ id: 'p' }, { extraction_status: 'pending' });
        const needsConfirm = wishItem({ id: 'n' }, { extraction_status: 'needs_confirm' });
        const resolved = wishItem({ id: 'a' }, { extraction_status: 'resolved' });

        const result = selectNearbyPinned([pending, needsConfirm, resolved], ORIGIN);
        expect(result.map((r) => r.row.id)).toEqual(['a']);
    });

    it('dedupes repeated restaurants', () => {
        const result = selectNearbyPinned(
            [wishItem({ id: 'a' }), wishItem({ id: 'a' })],
            ORIGIN,
        );
        expect(result).toHaveLength(1);
    });

    it('shapes rows for SearchResultRow with a formatted distance label', () => {
        const item = wishItem({
            id: 'a',
            name: 'Donia',
            city: 'Soho',
            cuisine: 'Levantine',
            photo_url: 'https://p.example/1.jpg',
            external_id: 'place-123',
            lat: ORIGIN.latitude + 0.004, // ≈ 0.28 mi
        });
        const [row] = selectNearbyPinned([item], ORIGIN);

        expect(row.row).toMatchObject({
            id: 'a',
            placeId: 'place-123',
            name: 'Donia',
            city: 'Soho',
            cuisine: 'Levantine',
            photoUrl: 'https://p.example/1.jpg',
            tier: 'onNapkin',
        });
        expect(row.distanceLabel).toBe('0.3 mi');
    });
});

// ── filterListsByQuery ───────────────────────────────────────────────────────

describe('filterListsByQuery', () => {
    const lists = [
        list('1', 'Date night'),
        list('2', 'Pasta pilgrimage'),
        list('3', 'Lisbon', 'pasta and custard tarts'),
        list('4', 'Cheap eats', 'late-night pasta bowls'),
        list('5', 'PASTA HALL OF FAME'),
    ];

    it('matches title case-insensitively', () => {
        expect(filterListsByQuery(lists, 'date').map((l) => l.id)).toEqual(['1']);
        expect(filterListsByQuery(lists, 'DATE').map((l) => l.id)).toEqual(['1']);
    });

    it('title matches rank before description matches, top 3', () => {
        expect(filterListsByQuery(lists, 'pasta').map((l) => l.id)).toEqual(['2', '5', '3']);
    });

    it('description is only a tiebreaker — fills remaining slots', () => {
        expect(filterListsByQuery(lists, 'pasta', 4).map((l) => l.id)).toEqual([
            '2',
            '5',
            '3',
            '4',
        ]);
    });

    it('returns [] for a blank query or no matches', () => {
        expect(filterListsByQuery(lists, '   ')).toEqual([]);
        expect(filterListsByQuery(lists, 'sushi')).toEqual([]);
    });

    it('handles null descriptions', () => {
        expect(filterListsByQuery([list('9', 'Solo', null)], 'anything')).toEqual([]);
    });
});
