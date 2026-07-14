import { isUnhandledFocus, mintFocusRequest } from '../focusRequest';

describe('focus round-trip (review F4 regression)', () => {
    it('focus → open restaurant (request cleared) → back → focus fires again', () => {
        const counter = { current: 0 };        // host focusSeqRef — never resets
        let handledSeq: number | null = null;  // map handledSeqRef — persists across nav

        // Locate tap: minted, unhandled, the map acts and marks it.
        const first = mintFocusRequest(counter, 'resto-1');
        expect(isUnhandledFocus(handledSeq, first)).toBe(true);
        handledSeq = first.seq;

        // Open restaurant → the host clears the request STATE only; neither
        // the counter nor the map's handled marker resets.
        expect(isUnhandledFocus(handledSeq, null)).toBe(false);

        // Back → locate the SAME restaurant again: the monotonic seq outruns
        // the persisted marker, so the focus fires again.
        const second = mintFocusRequest(counter, 'resto-1');
        expect(second.seq).toBeGreaterThan(first.seq);
        expect(isUnhandledFocus(handledSeq, second)).toBe(true);
    });

    it('a handled seq is consumed exactly once (re-renders no-op)', () => {
        const counter = { current: 0 };
        const request = mintFocusRequest(counter, 'resto-2');
        expect(isUnhandledFocus(null, request)).toBe(true);
        expect(isUnhandledFocus(request.seq, request)).toBe(false);
    });

    it('repeat taps on the same pin mint distinct seqs', () => {
        const counter = { current: 0 };
        const a = mintFocusRequest(counter, 'resto-3');
        const b = mintFocusRequest(counter, 'resto-3');
        expect(b.seq).toBe(a.seq + 1);
        expect(isUnhandledFocus(a.seq, b)).toBe(true);
    });
});
