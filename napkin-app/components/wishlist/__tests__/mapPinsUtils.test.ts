/**
 * mapPinsUtils unit tests — TICKET-108 wishlist map union/precedence.
 *
 * Pins the load-bearing rules (spec decision 3):
 *  - wishlist saves render as plain teardrops (emoji null)
 *  - a list pin's emoji overwrites a plain save (more specific)
 *  - among emoji'd lists, the newest updated_at wins
 *  - a null-emoji list pin never clobbers an emoji already set
 *  - one pin per restaurant; coord-less saves count as unmappable
 *  - city/cuisine/price filters apply to BOTH sources
 */
import { buildMapPins, type SaveInput, type ListPinInput } from '../mapPinsUtils';

function save(over: Partial<SaveInput> & { id: string }): SaveInput {
    return {
        name: 'Spot',
        city: 'Tokyo',
        cuisine: 'Japanese',
        price_level: 2,
        lat: 35.6,
        lng: 139.7,
        ...over,
    };
}

function pin(over: Partial<ListPinInput> & { restaurant_id: string }): ListPinInput {
    return {
        name: 'Spot',
        city: 'Tokyo',
        cuisine: 'Japanese',
        price_level: 2,
        lat: 35.6,
        lng: 139.7,
        emoji: null,
        list_updated_at: '2026-07-01T00:00:00Z',
        ...over,
    };
}

const NO_FILTERS = { city: null, cuisine: null, price: null };

describe('buildMapPins', () => {
    it('renders wishlist saves as plain teardrops (emoji null)', () => {
        const { items } = buildMapPins([save({ id: 'a' })], [], NO_FILTERS);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ id: 'a', emoji: null });
    });

    it('counts coord-less saves as unmappable, not pins', () => {
        const { items, unmappableSaves } = buildMapPins(
            [save({ id: 'a', lat: null, lng: null })],
            [],
            NO_FILTERS,
        );
        expect(items).toHaveLength(0);
        expect(unmappableSaves).toBe(1);
    });

    it('returns WHICH saves are unmappable (murmur tap-through), respecting filters', () => {
        const { unmappableSaves, unmappableSaveIds } = buildMapPins(
            [
                save({ id: 'a', lat: null, lng: null }),
                save({ id: 'b', lat: null, lng: null, city: 'London' }),
                save({ id: 'c' }), // mapped — not listed
            ],
            [],
            { city: 'Tokyo', cuisine: null, price: null }, // filters out b
        );
        expect(unmappableSaveIds).toEqual(['a']);
        expect(unmappableSaves).toBe(unmappableSaveIds.length);
    });

    it('list pin emoji overwrites a plain save for the same restaurant', () => {
        const { items } = buildMapPins(
            [save({ id: 'r1' })],
            [pin({ restaurant_id: 'r1', emoji: '🍣' })],
            NO_FILTERS,
        );
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ id: 'r1', emoji: '🍣' });
    });

    it('newest-updated emoji list wins when a restaurant is in two lists', () => {
        const { items } = buildMapPins(
            [],
            [
                pin({ restaurant_id: 'r1', emoji: '🍣', list_updated_at: '2026-07-01T00:00:00Z' }),
                pin({ restaurant_id: 'r1', emoji: '🍝', list_updated_at: '2026-07-05T00:00:00Z' }),
            ],
            NO_FILTERS,
        );
        expect(items).toHaveLength(1);
        expect(items[0].emoji).toBe('🍝'); // newer list
    });

    it('a null-emoji list pin does not clobber an emoji already set', () => {
        const { items } = buildMapPins(
            [],
            [
                pin({ restaurant_id: 'r1', emoji: '🍣', list_updated_at: '2026-07-05T00:00:00Z' }),
                pin({ restaurant_id: 'r1', emoji: null, list_updated_at: '2026-07-01T00:00:00Z' }),
            ],
            NO_FILTERS,
        );
        expect(items).toHaveLength(1);
        expect(items[0].emoji).toBe('🍣');
    });

    it('dedupes to one pin per restaurant across sources', () => {
        const { items } = buildMapPins(
            [save({ id: 'r1' }), save({ id: 'r2' })],
            [pin({ restaurant_id: 'r1', emoji: '🍕' })],
            NO_FILTERS,
        );
        expect(items).toHaveLength(2);
        const r1 = items.find((i) => i.id === 'r1');
        expect(r1?.emoji).toBe('🍕');
    });

    it('applies city/cuisine/price filters to BOTH sources', () => {
        const saves = [
            save({ id: 'a', city: 'Tokyo', cuisine: 'Japanese', price_level: 2 }),
            save({ id: 'b', city: 'Rome', cuisine: 'Italian', price_level: 3 }),
        ];
        const pins = [
            pin({ restaurant_id: 'c', city: 'Tokyo', cuisine: 'Japanese', price_level: 2, emoji: '🍣' }),
            pin({ restaurant_id: 'd', city: 'Rome', cuisine: 'Italian', price_level: 3, emoji: '🍝' }),
        ];
        const { items } = buildMapPins(saves, pins, { city: 'Tokyo', cuisine: null, price: null });
        const ids = items.map((i) => i.id).sort();
        expect(ids).toEqual(['a', 'c']); // only Tokyo rows from both sources
    });

    it('list pins with no coords are dropped silently (server already filters)', () => {
        const { items, unmappableSaves } = buildMapPins(
            [],
            [pin({ restaurant_id: 'r1', lat: null, lng: null, emoji: '🍜' })],
            NO_FILTERS,
        );
        expect(items).toHaveLength(0);
        expect(unmappableSaves).toBe(0); // list pins don't count toward "unmappable saves"
    });
});
