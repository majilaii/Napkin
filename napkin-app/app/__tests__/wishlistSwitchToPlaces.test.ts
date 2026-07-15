/**
 * TICKET-186 (A6/Codex #11): the map tab's "Places" affordance survives the
 * back-bridge deletion. `handleSwitchToPlaces` now delegates to the pure
 * `resolveSwitchToPlaces` — both surviving branches are asserted here so the
 * scoped-list push and the unscoped in-tab overlay switch can't regress.
 */
import { resolveSwitchToPlaces } from '@/components/wishlist/listMapScope';

describe('handleSwitchToPlaces routing (resolveSwitchToPlaces)', () => {
    it('scoped List → push /list/[id] (the sheet-over-map)', () => {
        const target = resolveSwitchToPlaces('list-42');
        expect(target).toEqual({ kind: 'push-list', listId: 'list-42' });
    });

    it('no scope → switch to the in-tab list overlay', () => {
        expect(resolveSwitchToPlaces(null)).toEqual({ kind: 'show-list-overlay' });
    });
});
