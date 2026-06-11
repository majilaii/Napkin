/**
 * pinnedLookupUtils unit tests — TICKET-074 fix-pass batch pinned lookup.
 *
 * Tests derivePinnedIds imported from the REAL module (not re-implemented):
 *  - collects restaurant ids across multiple pages
 *  - skips pending captures (restaurant === null)
 *  - null/undefined input safety
 */
import { derivePinnedIds } from '../pinnedLookupUtils';
import type { PersonalWishlistItem, PersonalWishlistPage } from '@/hooks/wishlist/useMyWishlist';

function makeItem(overrides: Partial<PersonalWishlistItem>): PersonalWishlistItem {
    return {
        id: 'item-1',
        note: null,
        created_at: '2026-06-11T00:00:00Z',
        restaurant: {
            id: 'aabbccdd-0000-4000-8000-000000000001',
            name: 'Berenjak',
            address: null,
            city: 'London',
            country: null,
            photo_url: null,
            cuisine: 'Persian',
            google_rating: null,
            price_level: null,
            external_id: null,
        },
        source: null,
        ...overrides,
    };
}

describe('derivePinnedIds', () => {
    it('collects restaurant ids across multiple pages', () => {
        const pages: PersonalWishlistPage[] = [
            {
                data: [
                    makeItem({ id: 'i1' }),
                    makeItem({
                        id: 'i2',
                        restaurant: {
                            ...makeItem({}).restaurant!,
                            id: 'aabbccdd-0000-4000-8000-000000000002',
                        },
                    }),
                ],
                next_cursor: '2026-06-01T00:00:00Z',
            },
            {
                data: [
                    makeItem({
                        id: 'i3',
                        restaurant: {
                            ...makeItem({}).restaurant!,
                            id: 'aabbccdd-0000-4000-8000-000000000003',
                        },
                    }),
                ],
                next_cursor: null,
            },
        ];
        const ids = derivePinnedIds(pages);
        expect(ids.size).toBe(3);
        expect(ids.has('aabbccdd-0000-4000-8000-000000000001')).toBe(true);
        expect(ids.has('aabbccdd-0000-4000-8000-000000000002')).toBe(true);
        expect(ids.has('aabbccdd-0000-4000-8000-000000000003')).toBe(true);
    });

    it('skips pending captures (restaurant === null)', () => {
        const pages: PersonalWishlistPage[] = [
            {
                data: [
                    makeItem({ id: 'pending', restaurant: null, extraction_status: 'pending' }),
                    makeItem({ id: 'resolved' }),
                ],
                next_cursor: null,
            },
        ];
        const ids = derivePinnedIds(pages);
        expect(ids.size).toBe(1);
        expect(ids.has('aabbccdd-0000-4000-8000-000000000001')).toBe(true);
    });

    it('returns an empty set for undefined, null, and empty pages', () => {
        expect(derivePinnedIds(undefined).size).toBe(0);
        expect(derivePinnedIds(null).size).toBe(0);
        expect(derivePinnedIds([]).size).toBe(0);
        expect(derivePinnedIds([{ data: [], next_cursor: null }]).size).toBe(0);
    });
});
