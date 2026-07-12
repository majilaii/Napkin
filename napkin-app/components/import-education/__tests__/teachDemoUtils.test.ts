/**
 * teachDemoUtils unit tests (TICKET-122) — the teach demo's beat state machine +
 * copy. Pins: four beats, advance clamps at the terminal beat (a tap past the end
 * is a no-op), the crossfade timings, and the exact Manrope copy (no emoji).
 */
import {
    BEAT_COUNT,
    LAST_BEAT,
    BEAT_TIMINGS_MS,
    advanceBeat,
    TEACH_COPY,
} from '../teachDemoUtils';

describe('beat machine', () => {
    it('has four beats', () => {
        expect(BEAT_COUNT).toBe(4);
        expect(LAST_BEAT).toBe(3);
    });

    it('advanceBeat steps 0 → 1 → 2 → 3', () => {
        expect(advanceBeat(0)).toBe(1);
        expect(advanceBeat(1)).toBe(2);
        expect(advanceBeat(2)).toBe(3);
    });

    it('advanceBeat clamps at the terminal beat (tap past the end is a no-op)', () => {
        expect(advanceBeat(3)).toBe(3);
        expect(advanceBeat(5)).toBe(3);
    });

    it('crossfade timings are ordered', () => {
        expect(BEAT_TIMINGS_MS.promiseToShare).toBe(2200);
        expect(BEAT_TIMINGS_MS.shareToSheet).toBe(4700);
        expect(BEAT_TIMINGS_MS.sheetToResult).toBe(7400);
        expect(BEAT_TIMINGS_MS.promiseToShare).toBeLessThan(BEAT_TIMINGS_MS.shareToSheet);
        expect(BEAT_TIMINGS_MS.shareToSheet).toBeLessThan(BEAT_TIMINGS_MS.sheetToResult);
    });
});

describe('copy (exact)', () => {
    it('the benefit line carries the differentiator', () => {
        expect(TEACH_COPY.resultBody).toBe('We watch the whole video — not just the caption.');
    });

    it('coach-mark strings are direct instructions', () => {
        expect(TEACH_COPY.shareTitle).toBe('Tap share on the video');
        expect(TEACH_COPY.sheetTitle).toBe('Then choose Napkin');
        expect(TEACH_COPY.doneCta).toBe('Start saving');
    });

    it('carries no emoji in any copy string', () => {
        const emoji = /\p{Extended_Pictographic}/u;
        for (const s of Object.values(TEACH_COPY)) expect(emoji.test(s)).toBe(false);
    });
});
