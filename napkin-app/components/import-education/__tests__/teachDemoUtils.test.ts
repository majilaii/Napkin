/**
 * teachDemoUtils unit tests (TICKET-122) — the teach demo's beat state machine +
 * copy. Pins: five beats, exact-target gating, terminal clamping, and exact
 * Manrope copy (no emoji).
 */
import {
    BEAT_COUNT,
    LAST_BEAT,
    REQUIRED_TARGETS,
    advanceOnTarget,
    TEACH_COPY,
} from '../teachDemoUtils';

describe('beat machine', () => {
    it('has five beats', () => {
        expect(BEAT_COUNT).toBe(5);
        expect(LAST_BEAT).toBe(4);
    });

    it('requires start → share → shareTo → napkin in that order', () => {
        expect(REQUIRED_TARGETS).toEqual(['start', 'share', 'shareTo', 'napkin']);
        expect(advanceOnTarget(0, 'start')).toBe(1);
        expect(advanceOnTarget(1, 'share')).toBe(2);
        expect(advanceOnTarget(2, 'shareTo')).toBe(3);
        expect(advanceOnTarget(3, 'napkin')).toBe(4);
    });

    it('ignores taps on the wrong simulated control', () => {
        expect(advanceOnTarget(0, 'share')).toBe(0);
        expect(advanceOnTarget(1, 'napkin')).toBe(1);
        expect(advanceOnTarget(2, 'share')).toBe(2);
        expect(advanceOnTarget(3, 'shareTo')).toBe(3);
    });

    it('clamps at the terminal beat', () => {
        expect(advanceOnTarget(4, 'napkin')).toBe(4);
        expect(advanceOnTarget(6, 'start')).toBe(4);
    });
});

describe('copy (exact)', () => {
    it('the benefit line carries the differentiator', () => {
        expect(TEACH_COPY.resultBody).toBe('We watch the whole video — not just the caption.');
    });

    it('coach-mark strings are direct instructions', () => {
        expect(TEACH_COPY.shareHint).toBe('Tap Share');
        expect(TEACH_COPY.shareToHint).toBe('Tap Share to...');
        expect(TEACH_COPY.napkinHint).toBe('Tap Napkin');
        expect(TEACH_COPY.startCta).toBe('Try it now');
        expect(TEACH_COPY.doneCta).toBe('Start saving');
    });

    it('carries no emoji in any copy string', () => {
        const emoji = /\p{Extended_Pictographic}/u;
        for (const s of Object.values(TEACH_COPY)) expect(emoji.test(s)).toBe(false);
    });
});
