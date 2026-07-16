import {
    fusePhotoSlideText,
    photoImportContextFromDiagnostics,
} from '../photoImportFusion';

describe('fusePhotoSlideText', () => {
    it('keeps slide boundaries, repeated lines, and the caption explicit', () => {
        expect(
            fusePhotoSlideText(
                [
                    ['Bar Termini', 'London guide'],
                    ['Swift, Soho', 'London guide'],
                    ['Satan\'s Whiskers', 'London guide'],
                ],
                'five bars worth crossing town for',
            ),
        ).toBe(
            '[slide 1 of 3]\n' +
                'Bar Termini\n' +
                'London guide\n' +
                '[slide 2 of 3]\n' +
                'Swift, Soho\n' +
                'London guide\n' +
                '[slide 3 of 3]\n' +
                "Satan's Whiskers\n" +
                'London guide\n' +
                '[caption]\n' +
                'five bars worth crossing town for',
        );
    });

    it('retains empty slide and caption sections instead of collapsing structure', () => {
        expect(fusePhotoSlideText([['First'], [], ['Third']], '')).toBe(
            '[slide 1 of 3]\nFirst\n' +
                '[slide 2 of 3]\n' +
                '[slide 3 of 3]\nThird\n' +
                '[caption]',
        );
    });
});

describe('photoImportContextFromDiagnostics', () => {
    it('restores the exact slide count across a review re-drain', () => {
        expect(
            photoImportContextFromDiagnostics({
                photo_post: true,
                photo_slides: 4,
                slide_count: 5,
            }),
        ).toEqual({ source_kind: 'photo', slide_count: 5 });
    });

    it('does not mark video diagnostics as photo context', () => {
        expect(photoImportContextFromDiagnostics({ photo_post: false, slide_count: 5 })).toBeNull();
    });

    it('rejects zero, fractional, and over-cap counts from a corrupt checkpoint', () => {
        expect(photoImportContextFromDiagnostics({ photo_post: true, slide_count: 0 })).toBeNull();
        expect(photoImportContextFromDiagnostics({ photo_post: true, slide_count: 2.5 })).toBeNull();
        expect(photoImportContextFromDiagnostics({ photo_post: true, slide_count: 13 })).toBeNull();
    });
});
