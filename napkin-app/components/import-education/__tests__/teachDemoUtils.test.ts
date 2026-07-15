import {
    BEAT_COUNT,
    LAST_BEAT,
    REQUIRED_TARGETS,
    advanceOnTarget,
    coverTransform,
    magnifierLayout,
    mapVideoPoint,
    spotlightBox,
    TEACH_COPY,
} from '../teachDemoUtils';

describe('TikTok tutorial state machine', () => {
    it('has six required interactions and one terminal result', () => {
        expect(BEAT_COUNT).toBe(7);
        expect(LAST_BEAT).toBe(6);
        expect(REQUIRED_TARGETS).toEqual([
            'start',
            'share',
            'tiktokMore',
            'iosMore',
            'napkin',
            'addForReview',
        ]);
    });

    it('requires the authentic TikTok → iOS → Napkin → confirm sequence', () => {
        expect(advanceOnTarget(0, 'start')).toBe(1);
        expect(advanceOnTarget(1, 'share')).toBe(2);
        expect(advanceOnTarget(2, 'tiktokMore')).toBe(3);
        expect(advanceOnTarget(3, 'iosMore')).toBe(4);
        expect(advanceOnTarget(4, 'napkin')).toBe(5);
        expect(advanceOnTarget(5, 'addForReview')).toBe(6);
    });

    it.each([
        [0, 'share'],
        [1, 'tiktokMore'],
        [2, 'iosMore'],
        [3, 'napkin'],
        [4, 'addForReview'],
        [5, 'share'],
    ] as const)('ignores the wrong target at beat %s', (beat, target) => {
        expect(advanceOnTarget(beat, target)).toBe(beat);
    });

    it('clamps before the first and after the terminal beat', () => {
        expect(advanceOnTarget(-2, 'start')).toBe(0);
        expect(advanceOnTarget(6, 'addForReview')).toBe(6);
        expect(advanceOnTarget(9, 'start')).toBe(6);
    });
});

describe('copy', () => {
    it('names TikTok and every required control directly', () => {
        expect(TEACH_COPY.introTitle).toBe('Save this TikTok');
        expect(TEACH_COPY.shareHint).toBe('Tap Share');
        expect(TEACH_COPY.tiktokMoreHint).toBe('Tap More');
        expect(TEACH_COPY.iosMoreHint).toBe('Tap More');
        expect(TEACH_COPY.napkinHint).toBe('Tap Napkin');
        expect(TEACH_COPY.addForReviewHint).toBe('Tap add for review');
    });

    it('carries a caption for every footage beat', () => {
        expect(TEACH_COPY.shareCaption.length).toBeGreaterThan(0);
        expect(TEACH_COPY.tiktokMoreCaption.length).toBeGreaterThan(0);
        expect(TEACH_COPY.iosMoreCaption.length).toBeGreaterThan(0);
        expect(TEACH_COPY.napkinCaption.length).toBeGreaterThan(0);
        expect(TEACH_COPY.addForReviewCaption.length).toBeGreaterThan(0);
    });

    it('keeps the whole-video differentiator and carries no emoji', () => {
        expect(TEACH_COPY.resultBody).toBe('We watch the whole video, not just the caption.');
        const emoji = /\p{Extended_Pictographic}/u;
        for (const value of Object.values(TEACH_COPY)) expect(emoji.test(value)).toBe(false);
    });
});

describe('cover geometry', () => {
    it('fills a same-aspect container exactly, no offsets', () => {
        const t = coverTransform(646, 1344, 323, 672);
        expect(t.scale).toBeCloseTo(0.5);
        expect(t.displayedWidth).toBeCloseTo(323);
        expect(t.displayedHeight).toBeCloseTo(672);
        expect(t.offsetX).toBeCloseTo(0);
        expect(t.offsetY).toBeCloseTo(0);
    });

    it('overflows horizontally on a narrower container and stays centered', () => {
        const t = coverTransform(646, 1344, 390, 866);
        expect(t.scale).toBeCloseTo(866 / 1344);
        expect(t.displayedWidth).toBeGreaterThan(390);
        expect(t.offsetX).toBeLessThan(0);
        expect(t.offsetY).toBeCloseTo(0);
        expect(mapVideoPoint(t, 0.5, 0.5).x).toBeCloseTo(195);
        expect(mapVideoPoint(t, 0.5, 0.5).y).toBeCloseTo(433);
    });

    it('overflows vertically on a wider container', () => {
        const t = coverTransform(646, 1344, 700, 700);
        expect(t.offsetX).toBeCloseTo(0);
        expect(t.offsetY).toBeLessThan(0);
    });

    it('maps a circle target into container pixels', () => {
        const t = coverTransform(100, 200, 100, 200);
        const box = spotlightBox(t, { kind: 'circle', x: 0.5, y: 0.25, r: 0.1 });
        expect(box).toEqual({ x: 40, y: 40, width: 20, height: 20, radius: 10 });
    });

    it('maps a rect target and caps its corner radius', () => {
        const t = coverTransform(100, 200, 100, 200);
        const box = spotlightBox(t, { kind: 'rect', x: 0.5, y: 0.5, w: 0.8, h: 0.2 });
        expect(box.x).toBeCloseTo(10);
        expect(box.y).toBeCloseTo(80);
        expect(box.width).toBeCloseTo(80);
        expect(box.height).toBeCloseTo(40);
        expect(box.radius).toBeLessThanOrEqual(18);
    });

    it('sizes the magnifier so the focus region fills the box width', () => {
        const m = magnifierLayout(646, 1344, 0.5, 0.5, 0.5, 300, 120);
        expect(m.imageWidth).toBeCloseTo(600);
        expect(m.imageHeight).toBeCloseTo(600 * (1344 / 646));
        expect(m.imageLeft).toBeCloseTo(150 - 300);
        expect(m.imageTop).toBeCloseTo(60 - 0.5 * m.imageHeight);
    });

    it('keeps an off-center magnifier focus centered in the box', () => {
        const m = magnifierLayout(646, 1344, 0.62, 0.63, 0.72, 340, 119);
        // The focus center must land at the box center.
        expect(0.62 * m.imageWidth + m.imageLeft).toBeCloseTo(170);
        expect(0.63 * m.imageHeight + m.imageTop).toBeCloseTo(59.5);
    });
});
