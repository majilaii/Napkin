import {
    allowsGenericUrlFallback,
    capPhotoImportCandidates,
    fusePhotoSlideText,
    photoImportContextFromDiagnostics,
} from '../photoImportFusion';

describe('fusePhotoSlideText', () => {
    it('puts the real title before packaging noise without merging slide boundaries', () => {
        expect(fusePhotoSlideText([['Wabisuke'], ['Kan Matsuzaki']], 'Japan in London', ' Keiko Uchida ')).toBe(
            '[title]\nKeiko Uchida\n[slide 1 of 2]\nWabisuke\n[slide 2 of 2]\nKan Matsuzaki\n[caption]\nJapan in London',
        );
    });

    it('preserves bounded title and caption even without usable slides or OCR', () => {
        expect(fusePhotoSlideText([], 'Japan in London', 'Keiko Uchida')).toBe(
            '[title]\nKeiko Uchida\n[caption]\nJapan in London',
        );
        expect(fusePhotoSlideText([], '', 'x'.repeat(1500))).toBe(`[title]\n${'x'.repeat(1000)}\n[caption]`);
    });
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

describe('capPhotoImportCandidates', () => {
    it('uses the 12-item listicle ceiling instead of a two-slide ceiling', () => {
        const tenCandidates = Array.from({ length: 10 }, (_, index) => `venue-${index + 1}`);

        expect(
            capPhotoImportCandidates(tenCandidates, {
                source_kind: 'photo',
                slide_count: 2,
            }),
        ).toEqual(tenCandidates);
    });

    it('keeps compatibility protection at 12 for photo imports only', () => {
        const thirteenCandidates = Array.from({ length: 13 }, (_, index) => index + 1);

        expect(
            capPhotoImportCandidates(thirteenCandidates, {
                source_kind: 'photo',
                slide_count: 1,
            }),
        ).toEqual(thirteenCandidates.slice(0, 12));
        expect(capPhotoImportCandidates(thirteenCandidates, null)).toBe(thirteenCandidates);
    });
});

describe('allowsGenericUrlFallback', () => {
    it('keeps title-only photo abstention authoritative without inventing slide count', () => {
        expect(allowsGenericUrlFallback(null, true)).toBe(false);
        expect(allowsGenericUrlFallback(null, false)).toBe(true);
    });
    it('does not let a generic prompt bypass valid photo scene-noise rules', () => {
        expect(
            allowsGenericUrlFallback({
                source_kind: 'photo',
                slide_count: 5,
            }),
        ).toBe(false);
        expect(allowsGenericUrlFallback(null)).toBe(true);
    });
});
