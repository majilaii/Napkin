/**
 * teachDemoUtils unit tests (TICKET-122) — the teach demo's beat state machine +
 * copy. Pins: three beats, advance clamps at the terminal beat (a tap past the end
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
    it('has three beats', () => {
        expect(BEAT_COUNT).toBe(3);
        expect(LAST_BEAT).toBe(2);
    });

    it('advanceBeat steps 0 → 1 → 2', () => {
        expect(advanceBeat(0)).toBe(1);
        expect(advanceBeat(1)).toBe(2);
    });

    it('advanceBeat clamps at the terminal beat (tap past the end is a no-op)', () => {
        expect(advanceBeat(2)).toBe(2);
        expect(advanceBeat(5)).toBe(2);
    });

    it('crossfade timings are ordered t0 < beat1→2 < beat2→3', () => {
        expect(BEAT_TIMINGS_MS.beat1To2).toBe(2400);
        expect(BEAT_TIMINGS_MS.beat2To3).toBe(5400);
        expect(BEAT_TIMINGS_MS.beat1To2).toBeLessThan(BEAT_TIMINGS_MS.beat2To3);
    });
});

describe('copy (exact)', () => {
    it('the benefit line carries the differentiator', () => {
        expect(TEACH_COPY.benefit).toBe('we watch the whole video — not just the caption.');
    });

    it('coach-mark + pro-tip strings are verbatim', () => {
        expect(TEACH_COPY.tapShare).toBe('tap share');
        expect(TEACH_COPY.tapNapkin).toBe('tap napkin');
        expect(TEACH_COPY.proTip).toBe('add napkin to your share favourites — one tap next time.');
    });

    it('keeps the single serif brand moment (brandLine) + kicker', () => {
        expect(TEACH_COPY.kicker).toBe('the good part');
        expect(TEACH_COPY.brandLine).toBe('save from anywhere');
    });

    it('carries no emoji in any copy string', () => {
        const emoji = /\p{Extended_Pictographic}/u;
        for (const s of Object.values(TEACH_COPY)) expect(emoji.test(s)).toBe(false);
    });
});
