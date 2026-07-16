import {
    buildCompletenessDestinationIntent,
    expectedImportDestinations,
    importDestinationTargets,
    reconcileImportDestinationNonces,
} from './importProtocol';

describe('restaurant completeness destination protocol', () => {
    it('keeps existing nonces stable while adding and pruning destinations', () => {
        let n = 0;
        const uuid = () => `nonce-${++n}`;
        const first = reconcileImportDestinationNonces(
            {
                wishlist: true,
                tableIds: ['table-a'],
                listIds: ['list-a'],
                newListTitles: ['Paris'],
            },
            undefined,
            uuid,
        );
        const second = reconcileImportDestinationNonces(
            {
                wishlist: true,
                tableIds: ['table-a', 'table-b'],
                listIds: [],
                newListTitles: ['Paris'],
            },
            first,
            uuid,
        );

        expect(second.wishlist).toBe(first.wishlist);
        expect(second.tables['table-a']).toBe(first.tables['table-a']);
        expect(second.tables['table-b']).toBe('nonce-6');
        expect(second.lists).toEqual({});
        expect(second.newLists.Paris).toEqual(first.newLists.Paris);
    });

    it('expands item × destination records with immutable routing payloads', () => {
        const nonces = {
            wishlist: 'wish-nonce',
            tables: { t1: 'table-nonce' },
            lists: { l1: 'list-nonce' },
            newLists: {
                Lisbon: { destinationNonce: 'new-nonce', titleNonce: 'title-nonce' },
            },
        };
        const targets = importDestinationTargets(
            {
                wishlist: true,
                tableIds: ['t1'],
                listIds: ['l1'],
                newListTitles: ['Lisbon'],
            },
            nonces,
        );
        const intents = buildCompletenessDestinationIntent(['item-a', 'item-b'], targets);

        expect(expectedImportDestinations(2, targets.length)).toBe(8);
        expect(intents).toHaveLength(8);
        expect(intents).toContainEqual({
            item_nonce: 'item-a',
            destination_nonce: 'table-nonce',
            destination_kind: 'table',
            target_table_id: 't1',
            notify_done: false,
        });
        expect(intents).toContainEqual({
            item_nonce: 'item-b',
            destination_nonce: 'new-nonce',
            destination_kind: 'new_list',
            target_list_title: 'Lisbon',
            title_nonce: 'title-nonce',
            notify_done: false,
        });
        expect(intents.filter((intent) => intent.notify_done)).toHaveLength(2);
        expect(
            buildCompletenessDestinationIntent(['item-a'], targets, false).every(
                (intent) => intent.notify_done === false,
            ),
        ).toBe(true);
    });
});
