import { FULL, HALF, PEEK } from '@/components/sheets/snapSheetMath';

describe('placesScreenState auth isolation', () => {
    it('resets query, selection, detent, segment, and restoration state on identity change', () => {
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
            previousNonPeopleSnap: HALF,
        });

        placesScreenState.setActiveUser('user-b');
        expect(placesScreenState.get('user-b')).toEqual({
            query: '',
            sheetSnap: PEEK,
            selectedPinId: null,
            scrollOffset: 0,
            activeSegment: 'places',
            previousNonPeopleSnap: null,
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
        previousNonPeopleSnap: null,
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
