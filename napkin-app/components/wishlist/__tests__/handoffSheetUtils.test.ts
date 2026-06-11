/**
 * handoffSheetUtils unit tests — TICKET-074.
 *
 * Tests the pure logic that HandoffSheet renders/sends, imported from the REAL
 * module (not re-implemented):
 *  - buildCreateInput: listId prop → handoff?action=create input pass-through.
 *  - buildShareMessage: wishlist vs list copy; singular/plural counts.
 *  - sheetTitle / primaryCtaLabel: copy adapts per mode.
 *
 * Full render tests require native setup; these cover the JS logic.
 */
import {
    buildCreateInput,
    buildShareMessage,
    sheetTitle,
    primaryCtaLabel,
} from '../handoffSheetUtils';

const LIST_ID = 'aabbccdd-0000-4000-8000-000000000001';
const URL = 'https://x.supabase.co/functions/v1/share-page?t=ABCdefGHIjklMNOpqrSTUv';

describe('buildCreateInput (HandoffSheet → useCreateHandoff pass-through)', () => {
    it('passes list_id through when the sheet targets a list', () => {
        expect(buildCreateInput(LIST_ID)).toEqual({ list_id: LIST_ID });
    });

    it('returns undefined for wishlist shares (no listId prop)', () => {
        expect(buildCreateInput(undefined)).toBeUndefined();
    });

    it('treats empty-string listId as a wishlist share', () => {
        expect(buildCreateInput('')).toBeUndefined();
    });
});

describe('buildShareMessage', () => {
    it('wishlist share keeps the TICKET-072 copy with count + url on its own line', () => {
        expect(buildShareMessage({ count: 3, shareUrl: URL })).toBe(
            `my napkin — 3 spots, folded for you.\n${URL}`,
        );
    });

    it('wishlist share singularizes one spot', () => {
        expect(buildShareMessage({ count: 1, shareUrl: URL })).toBe(
            `my napkin — 1 spot, folded for you.\n${URL}`,
        );
    });

    it('list share leads with the frozen list name', () => {
        expect(buildShareMessage({ listName: 'Tokyo trip', count: 5, shareUrl: URL })).toBe(
            `my Tokyo trip, folded for you.\n${URL}`,
        );
    });

    it('null listName falls back to the wishlist copy', () => {
        expect(buildShareMessage({ listName: null, count: 2, shareUrl: URL })).toBe(
            `my napkin — 2 spots, folded for you.\n${URL}`,
        );
    });
});

describe('sheet copy', () => {
    it('sheetTitle: list name when present, "your napkin" otherwise', () => {
        expect(sheetTitle('Tokyo trip')).toBe('Tokyo trip');
        expect(sheetTitle(undefined)).toBe('your napkin');
        expect(sheetTitle(null)).toBe('your napkin');
        expect(sheetTitle('')).toBe('your napkin');
    });

    it('primaryCtaLabel: "share this list" / "share my napkin"', () => {
        expect(primaryCtaLabel('Tokyo trip')).toBe('share this list');
        expect(primaryCtaLabel(undefined)).toBe('share my napkin');
        expect(primaryCtaLabel(null)).toBe('share my napkin');
    });
});
