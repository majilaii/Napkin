import {
    BEAT_COUNT,
    LAST_BEAT,
    REQUIRED_TARGETS,
    advanceOnTarget,
    TEACH_COPY,
} from '../teachDemoUtils';

describe('TikTok tutorial state machine', () => {
    it('has seven required interactions and one terminal result', () => {
        expect(BEAT_COUNT).toBe(8);
        expect(LAST_BEAT).toBe(7);
        expect(REQUIRED_TARGETS).toEqual([
            'start',
            'share',
            'tiktokMore',
            'iosMore',
            'napkin',
            'addForReview',
            'approveAll',
        ]);
    });

    it('requires the authentic TikTok → iOS → Napkin → review sequence', () => {
        expect(advanceOnTarget(0, 'start')).toBe(1);
        expect(advanceOnTarget(1, 'share')).toBe(2);
        expect(advanceOnTarget(2, 'tiktokMore')).toBe(3);
        expect(advanceOnTarget(3, 'iosMore')).toBe(4);
        expect(advanceOnTarget(4, 'napkin')).toBe(5);
        expect(advanceOnTarget(5, 'addForReview')).toBe(6);
        expect(advanceOnTarget(6, 'approveAll')).toBe(7);
    });

    it.each([
        [0, 'share'],
        [1, 'tiktokMore'],
        [2, 'iosMore'],
        [3, 'napkin'],
        [4, 'share'],
        [5, 'approveAll'],
        [6, 'addForReview'],
        [1, 'addForReview'],
        [4, 'approveAll'],
    ] as const)('ignores the wrong target at beat %s', (beat, target) => {
        expect(advanceOnTarget(beat, target)).toBe(beat);
    });

    it('clamps before the first and after the terminal beat', () => {
        expect(advanceOnTarget(-2, 'start')).toBe(0);
        expect(advanceOnTarget(7, 'approveAll')).toBe(7);
        expect(advanceOnTarget(9, 'start')).toBe(7);
    });
});

describe('copy', () => {
    it('names TikTok and every required control directly', () => {
        expect(TEACH_COPY.introTitle).toBe('Save this TikTok');
        expect(TEACH_COPY.shareHint).toBe('Tap Share');
        expect(TEACH_COPY.tiktokMoreHint).toBe('Tap More');
        expect(TEACH_COPY.iosMoreHint).toBe('Tap More');
        expect(TEACH_COPY.napkinHint).toBe('Tap Napkin');
    });

    it('keeps the whole-video differentiator and carries no emoji', () => {
        expect(TEACH_COPY.resultBody).toBe('We watch the whole video — not just the caption.');
        const emoji = /\p{Extended_Pictographic}/u;
        for (const value of Object.values(TEACH_COPY)) expect(emoji.test(value)).toBe(false);
    });
});
