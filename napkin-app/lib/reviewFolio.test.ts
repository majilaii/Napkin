import { getReviewFolioMode, hasReviewWriting } from './reviewFolio';

const blankWritingState = {
    content: null,
    dishDescription: null,
    hasCategoryRatings: false,
    ownerEditing: false,
    isEditingNote: false,
    isEditingDish: false,
    isEditingBreakdown: false,
};

describe('review Folio mode', () => {
    it('lets photos lead even when the review also has writing', () => {
        expect(getReviewFolioMode(true, true)).toBe('photos');
    });

    it('lets writing lead when there are no photos', () => {
        expect(getReviewFolioMode(false, true)).toBe('writing');
    });

    it('collapses a rating-only visit to the ledger', () => {
        expect(getReviewFolioMode(false, false)).toBe('ledger');
    });
});

describe('review writing state', () => {
    it.each([
        ['authored note', { content: 'Worth the wait.' }],
        ['dish note', { dishDescription: 'spicy rigatoni' }],
        ['category ratings', { hasCategoryRatings: true }],
        ['owner edit mode', { ownerEditing: true }],
        ['active note editor', { isEditingNote: true }],
        ['active dish editor', { isEditingDish: true }],
        ['active breakdown editor', { isEditingBreakdown: true }],
    ] as const)('keeps the writing surface mounted for %s', (_label, override) => {
        expect(hasReviewWriting({ ...blankWritingState, ...override })).toBe(true);
    });

    it('ignores whitespace-only content', () => {
        expect(
            hasReviewWriting({
                ...blankWritingState,
                content: '   ',
                dishDescription: '\n',
            }),
        ).toBe(false);
    });
});
