import { getEntryInteractionContext } from './entryInteractions';

describe('getEntryInteractionContext', () => {
    it('enables Table interactions for an entry linked to a Table', () => {
        expect(getEntryInteractionContext({ id: 'entry-1', table_id: 'table-1' }, false)).toEqual({
            enabled: true,
            scope: 'table',
            targetType: 'entry',
            targetId: 'entry-1',
        });
    });

    it('enables public interactions without requiring a Table link', () => {
        expect(getEntryInteractionContext({ id: 'entry-1', table_id: null }, true)).toEqual({
            enabled: true,
            scope: 'public',
            targetType: 'entry',
            targetId: 'entry-1',
        });
    });

    it('disables interactions for a private solo journal entry', () => {
        expect(getEntryInteractionContext({ id: 'entry-1', table_id: null }, false)).toEqual({
            enabled: false,
            scope: 'table',
            targetType: null,
            targetId: null,
        });
    });

    it('stays disabled while the entry is loading', () => {
        expect(getEntryInteractionContext(undefined, false)).toEqual({
            enabled: false,
            scope: 'table',
            targetType: null,
            targetId: null,
        });
    });
});
