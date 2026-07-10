/**
 * activationHubUtils unit tests (TICKET-122) — the hub's variant + copy + glyph
 * logic. Pins the load-bearing rules so the component stays a thin renderer:
 *  - auto → compact once imported, else full; explicit variants pass through
 *  - the four sources + their neutral (non-brand) Ionicons glyphs
 *  - the exact, cut-hard copy strings + the derived compact one-liner
 */
import {
    SOURCE_APPS,
    GLYPH_FOR_SOURCE,
    HUB_COPY,
    COMPACT_LINE,
    resolveHubVariant,
    modeLine,
    type SourceApp,
} from '../activationHubUtils';

describe('resolveHubVariant', () => {
    it('auto → full when the user has not imported', () => {
        expect(resolveHubVariant('auto', false)).toBe('full');
    });

    it('auto → compact once the user has imported', () => {
        expect(resolveHubVariant('auto', true)).toBe('compact');
    });

    it('explicit variants pass through regardless of hasImported', () => {
        expect(resolveHubVariant('full', true)).toBe('full');
        expect(resolveHubVariant('compact', false)).toBe('compact');
    });
});

describe('modeLine', () => {
    it('auto pins for you; review waits for confirmation', () => {
        expect(modeLine('auto')).toBe('we pin them for you.');
        expect(modeLine('review')).toBe('you confirm them first.');
    });

    it('matches the HUB_COPY constants', () => {
        expect(modeLine('auto')).toBe(HUB_COPY.modeAuto);
        expect(modeLine('review')).toBe(HUB_COPY.modeReview);
    });
});

describe('sources + glyphs', () => {
    it('teaches exactly TikTok · Instagram · Photos · Safari, in order', () => {
        expect(SOURCE_APPS).toEqual(['TikTok', 'Instagram', 'Photos', 'Safari']);
    });

    it('maps every source to a neutral Ionicons outline glyph (no brand marks)', () => {
        const allowed = new Set(['arrow-redo-outline', 'paper-plane-outline', 'share-outline']);
        for (const source of SOURCE_APPS) {
            const glyph = GLYPH_FOR_SOURCE[source as SourceApp];
            expect(allowed.has(glyph)).toBe(true);
            expect(glyph.endsWith('-outline')).toBe(true);
        }
        // The iOS share box for Photos + Safari; the share curve / plane for the socials.
        expect(GLYPH_FOR_SOURCE.Photos).toBe('share-outline');
        expect(GLYPH_FOR_SOURCE.Safari).toBe('share-outline');
        expect(GLYPH_FOR_SOURCE.TikTok).toBe('arrow-redo-outline');
        expect(GLYPH_FOR_SOURCE.Instagram).toBe('paper-plane-outline');
    });
});

describe('copy (exact, cut hard)', () => {
    it('full-variant strings are verbatim', () => {
        expect(HUB_COPY.kicker).toBe('SAVE SPOTS FROM');
        expect(HUB_COPY.gesture).toBe('tap share, then napkin');
        expect(HUB_COPY.hubLink).toBe('your imports');
    });

    it('compact one-liner is derived from the sources and never drifts', () => {
        expect(COMPACT_LINE).toBe('save spots from TikTok · Instagram · Photos · Safari');
        expect(COMPACT_LINE).toBe(`save spots from ${SOURCE_APPS.join(' · ')}`);
    });

    it('carries no emoji in any copy string', () => {
        const emoji = /\p{Extended_Pictographic}/u;
        const strings = [...Object.values(HUB_COPY), COMPACT_LINE];
        for (const s of strings) expect(emoji.test(s)).toBe(false);
    });
});
