import {
    peekActionsForPresentation,
    type PeekPresentationActions,
} from '../peekActions';
import type { WishlistMapItem } from '../mapShared';

const base: WishlistMapItem = {
    id: 'restaurant-1',
    name: 'Cafe',
    city: 'London',
    cuisine: 'Cafe',
    lat: 51.5,
    lng: -0.1,
};

const cases: Array<[string, WishlistMapItem, PeekPresentationActions]> = [
    ['saved', base, { slot1: 'log_visit', slot2: 'wishlist', slot3: 'directions' }],
    ['been', { ...base, been: true }, { slot1: 'directions', slot2: 'wishlist', slot3: 'log_again' }],
    ['network', { ...base, entryId: 'entry-1' }, { slot1: 'wishlist', slot2: 'view_restaurant', slot3: 'log_visit' }],
    ['overlap', { ...base, overlap: { count: 2, tableId: 'table-1', tableName: 'Table', members: [] } }, { slot1: 'gather_here', slot2: 'wishlist', slot3: 'view_restaurant' }],
    ['gathered', { ...base, been: true, gathered: { tableId: 'table-1', on: '2026-07-15', participants: [], suppersCount: 1 } }, { slot1: 'view_restaurant', slot2: 'wishlist', slot3: 'directions' }],
    ['list', { ...base, listContext: { listId: 'list-1', rank: 1 } }, { slot1: 'wishlist', slot2: 'view_restaurant', slot3: 'directions' }],
];

describe('peekActionsForPresentation', () => {
    it.each(cases)('uses the literal %s slot table', (_layer, item, expected) => {
        expect(peekActionsForPresentation(item, { reserveResolved: false })).toEqual(expected);
    });

    it('uses a resolved reserve only for the next saved-card presentation', () => {
        const currentPresentation = peekActionsForPresentation(base, { reserveResolved: false });

        // Enrichment resolves while this presentation is live. The caller keeps
        // its snapshot, and only a subsequent presentation runs the selector.
        expect(currentPresentation.slot3).toBe('directions');
        expect(peekActionsForPresentation(base, { reserveResolved: true }).slot3).toBe('reserve');
        expect(currentPresentation.slot3).toBe('directions');
    });
});
