import {
    importCompletionToastCopy,
    isListOnlyImportOutcome,
} from './importCompletionCopy';

describe('import completion copy', () => {
    it('reports all-exhausted wishlist-routed ghosts as fresh pins', () => {
        const listOnly = isListOnlyImportOutcome(true, 3);
        expect(listOnly).toBe(false);
        expect(importCompletionToastCopy({
            queued: 0,
            saved: 0,
            ghost: 3,
            done: 3,
            listOnly,
            fastPathName: null,
            truncationNote: null,
            listNoun: 'your lists',
            singleSpotName: null,
            spotCount: 3,
        })).toBe('pinned 3 spots');
    });

    it('names a single wishlist-routed ghost pin', () => {
        expect(importCompletionToastCopy({
            queued: 0,
            saved: 0,
            ghost: 1,
            done: 1,
            listOnly: false,
            fastPathName: null,
            truncationNote: null,
            listNoun: 'your list',
            singleSpotName: 'Parisik',
            spotCount: 1,
        })).toBe('pinned Parisik');
    });

    it('keeps a pure already-pinned re-drain on wishlist copy', () => {
        expect(importCompletionToastCopy({
            queued: 0,
            saved: 0,
            ghost: 0,
            done: 2,
            listOnly: false,
            fastPathName: null,
            truncationNote: null,
            listNoun: 'your lists',
            singleSpotName: null,
            spotCount: 2,
        })).toBe('already in your wishlist');
    });

    it('keeps an explicit list-only ghost save on list copy', () => {
        const listOnly = isListOnlyImportOutcome(false, 1);
        expect(listOnly).toBe(true);
        expect(importCompletionToastCopy({
            queued: 0,
            saved: 0,
            ghost: 1,
            done: 1,
            listOnly,
            fastPathName: null,
            truncationNote: null,
            listNoun: 'your list',
            singleSpotName: 'Parisik',
            spotCount: 1,
        })).toBe('saved Parisik to your list');
    });
});
