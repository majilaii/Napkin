import { isUnhandledFocus, mintFocusRequest, resolveSettleFocus } from '../focusRequest';

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

describe('resolveSettleFocus (review G1)', () => {
    const PEEK = 0;
    const HALF = 1;
    const FULL = 2;

    it('fires the pending focus only when the sheet settles at peek', () => {
        expect(resolveSettleFocus('resto-1', PEEK, PEEK)).toEqual({ fire: 'resto-1' });
        expect(resolveSettleFocus(null, PEEK, PEEK)).toEqual({ fire: null });
    });

    it('discards a superseded focus on any non-peek settle', () => {
        expect(resolveSettleFocus('resto-1', HALF, PEEK)).toEqual({ fire: null });
        expect(resolveSettleFocus('resto-1', FULL, PEEK)).toEqual({ fire: null });
    });

    it('a discarded focus never fires on a later unrelated peek settle', () => {
        // Locate tapped → transition superseded (settled at half) → pending
        // consumed. The host clears its ref on EVERY settle, so the later peek
        // settle sees null pending — no stale camera move.
        let pending: string | null = 'resto-1';
        expect(resolveSettleFocus(pending, HALF, PEEK)).toEqual({ fire: null });
        pending = null; // host: pendingFocusRef.current = null on every settle
        expect(resolveSettleFocus(pending, PEEK, PEEK)).toEqual({ fire: null });
    });
});

describe('collection-framing gate (review G2)', () => {
    it('framing is skipped while a focus is unhandled and resumes once acted on', () => {
        const counter = { current: 0 };
        let handledSeq: number | null = null;

        const request = mintFocusRequest(counter, 'resto-1');
        // Unhandled focus owns the camera → the framing effect must skip.
        expect(isUnhandledFocus(handledSeq, request)).toBe(true);
        // The focus handler acts, marks handled (and consumes the frame key).
        handledSeq = request.seq;
        // Framing may run again (e.g. a later membership change).
        expect(isUnhandledFocus(handledSeq, request)).toBe(false);
    });
});
