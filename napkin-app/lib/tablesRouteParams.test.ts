import { applyTablesRouteParams } from './tablesRouteParams';

describe('Tables route params', () => {
    const tables = [
        { tables: { id: 'a' } },
        { tables: { id: 'b' } },
    ];

    it('selects the requested Table and resets an already-mounted screen to Activity', () => {
        let selectedIndex = 0;
        let activeTab: 'activity' | 'lists' = 'lists';
        applyTablesRouteParams(
            { selected: 'b', section: 'activity' },
            tables,
            (index) => { selectedIndex = index; },
            (tab) => { activeTab = tab; },
        );

        expect(selectedIndex).toBe(1);
        expect(activeTab).toBe('activity');
    });

    it('leaves the active pane untouched when section is absent', () => {
        let activeTab: 'activity' | 'lists' = 'lists';
        applyTablesRouteParams(
            { selected: 'b' },
            tables,
            () => undefined,
            (tab) => { activeTab = tab; },
        );

        expect(activeTab).toBe('lists');
    });

    it('re-applies identical values delivered as a new param instance', () => {
        let calls = 0;
        for (const params of [
            { selected: 'a', section: 'activity' },
            { selected: 'a', section: 'activity' },
        ]) {
            applyTablesRouteParams(
                params,
                tables,
                () => undefined,
                () => { calls += 1; },
            );
        }
        expect(calls).toBe(2);
    });
});
