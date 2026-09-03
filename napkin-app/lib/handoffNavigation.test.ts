import {
    dismissHandoff,
    HANDOFF_FALLBACK_ROUTE,
    PINNED_PLACES_ROUTE,
} from './handoffNavigation';

describe('dismissHandoff', () => {
    it('backs out when handoff has a parent route', () => {
        const router = {
            canGoBack: jest.fn(() => true),
            back: jest.fn(),
            replace: jest.fn(),
        };

        dismissHandoff(router);

        expect(router.back).toHaveBeenCalledTimes(1);
        expect(router.replace).not.toHaveBeenCalled();
    });

    it('replaces with the pinned Places list on a cold deep link', () => {
        const router = {
            canGoBack: jest.fn(() => false),
            back: jest.fn(),
            replace: jest.fn(),
        };

        dismissHandoff(router);

        expect(router.back).not.toHaveBeenCalled();
        expect(router.replace).toHaveBeenCalledWith(HANDOFF_FALLBACK_ROUTE);
        expect(PINNED_PLACES_ROUTE).toBe('/(tabs)/places?view=list&layer=pinned');
    });
});
