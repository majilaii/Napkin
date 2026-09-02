/**
 * TICKET-106 — search tab ordering + the Lists-survives-curtain invariant.
 */
import { visibleSearchTabs } from '../searchModeTabsGate';

describe('visibleSearchTabs', () => {
    it('shows places · lists · people in order when people-search is on', () => {
        expect(visibleSearchTabs(false).map((t) => t.mode)).toEqual([
            'places',
            'lists',
            'people',
        ]);
    });

    it('drops People but KEEPS Lists when people-search is curtained', () => {
        const modes = visibleSearchTabs(true).map((t) => t.mode);
        expect(modes).toEqual(['places', 'lists']);
        expect(modes).not.toContain('people');
        expect(modes).toContain('lists');
    });

    it('Lists always comes after Places (never first)', () => {
        for (const hidePeople of [false, true]) {
            const modes = visibleSearchTabs(hidePeople).map((t) => t.mode);
            expect(modes.indexOf('lists')).toBeGreaterThan(modes.indexOf('places'));
        }
    });
});
