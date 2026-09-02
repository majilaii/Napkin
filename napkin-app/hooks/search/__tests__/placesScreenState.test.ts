import { FULL, HALF, PEEK } from '@/components/sheets/snapSheetMath';

describe('placesScreenState auth isolation', () => {
    it('resets query, selection, detent, segment, layer, and restoration state on identity change', () => {
        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { placesScreenState } = require('../placesScreenState');
        placesScreenState.setActiveUser('user-a');
        placesScreenState.patch('user-a', {
            query: 'parisik',
            sheetSnap: FULL,
            selectedPinId: 'place:abc',
            scrollOffset: 88,
            activeSegment: 'people',
            layerFilter: 'been',
            previousNonPeopleSnap: HALF,
            previousNonSearchSnap: PEEK,
        });

        placesScreenState.setActiveUser('user-b');
        expect(placesScreenState.get('user-b')).toEqual({
            query: '',
            sheetSnap: PEEK,
            selectedPinId: null,
            scrollOffset: 0,
            activeSegment: 'places',
            layerFilter: 'all',
            previousNonPeopleSnap: null,
            previousNonSearchSnap: null,
        });
        expect(placesScreenState.get('user-a')).toEqual(placesScreenState.get('user-b'));
    });
});

describe('transitionPlacesSegment', () => {
    const base = {
        query: '',
        sheetSnap: PEEK,
        selectedPinId: null,
        scrollOffset: 0,
        activeSegment: 'places' as const,
        layerFilter: 'all' as const,
        previousNonPeopleSnap: null,
        previousNonSearchSnap: null,
    };

    it('raises People and restores peek when returning to Places', () => {
        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { transitionPlacesSegment } = require('../placesScreenState');
        const people = transitionPlacesSegment(base, 'people', false);
        expect(people).toMatchObject({ activeSegment: 'people', sheetSnap: FULL, previousNonPeopleSnap: PEEK });
        expect(transitionPlacesSegment(people, 'places', false)).toMatchObject({
            activeSegment: 'places',
            sheetSnap: PEEK,
            previousNonPeopleSnap: null,
        });
    });

    it('restores half when leaving People for Lists', () => {
        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { transitionPlacesSegment } = require('../placesScreenState');
        const people = transitionPlacesSegment({ ...base, sheetSnap: HALF }, 'people', false);
        expect(transitionPlacesSegment(people, 'lists', false)).toMatchObject({
            activeSegment: 'lists',
            sheetSnap: HALF,
        });
    });

    it('falls a hidden People request back to Places without raising', () => {
        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { transitionPlacesSegment } = require('../placesScreenState');
        expect(transitionPlacesSegment(base, 'people', true)).toBe(base);
    });
});

describe('places layer filters', () => {
    it('defaults to all and toggles or switches the one active filter', () => {
        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { placesScreenState, togglePlacesLayerFilter } = require('../placesScreenState');
        placesScreenState.setActiveUser('layer-user');

        expect(placesScreenState.get('layer-user').layerFilter).toBe('all');
        expect(togglePlacesLayerFilter('all', 'pinned')).toBe('pinned');
        expect(togglePlacesLayerFilter('pinned', 'pinned')).toBe('all');
        expect(togglePlacesLayerFilter('pinned', 'been')).toBe('been');
        expect(togglePlacesLayerFilter('been', 'been')).toBe('all');
    });
});

describe('focused Places search transitions', () => {
    const base = {
        query: '',
        sheetSnap: HALF,
        selectedPinId: 'restaurant-1',
        scrollOffset: 42,
        activeSegment: 'lists' as const,
        layerFilter: 'pinned' as const,
        previousNonPeopleSnap: null,
        previousNonSearchSnap: null,
    };

    it('focuses at full height and back restores the snap, segment, and filter', () => {
        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { enterPlacesSearch, leavePlacesSearch } = require('../placesScreenState');

        const focused = enterPlacesSearch(base);
        expect(focused).toMatchObject({ sheetSnap: FULL, previousNonSearchSnap: HALF });
        expect(enterPlacesSearch(focused)).toBe(focused);

        expect(leavePlacesSearch({ ...focused, query: 'parisik' })).toMatchObject({
            query: '',
            sheetSnap: HALF,
            activeSegment: 'lists',
            layerFilter: 'pinned',
            previousNonSearchSnap: null,
        });
    });
});

describe('queryForPlacesRouteArrival', () => {
    it('clears a stale saved query when mode=lists arrives without q', () => {
        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { queryForPlacesRouteArrival } = require('../placesScreenState');

        expect(queryForPlacesRouteArrival('old dinner', undefined, 'lists')).toBe('');
    });

    it('keeps an explicit q and retains state for an ordinary tab arrival', () => {
        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { queryForPlacesRouteArrival } = require('../placesScreenState');

        expect(queryForPlacesRouteArrival('old dinner', '  paris  ', 'people')).toBe('paris');
        expect(queryForPlacesRouteArrival('old dinner', undefined, null)).toBe('old dinner');
    });
});
