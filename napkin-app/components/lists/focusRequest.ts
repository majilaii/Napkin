/**
 * focusRequest — the event-like row-locate/pin-tap focus contract between the
 * list-detail host and `ScopedListMap` (TICKET-186, Codex #8 / review F4).
 *
 * The seq is MONOTONIC for the life of the screen and never resets: the map's
 * handled marker persists across a restaurant push/back round-trip, so a
 * counter that restarted (e.g. re-derived from cleared request state) would
 * mint an already-handled seq and silently suppress the re-focus.
 */
export interface FocusRequest {
    id: string;
    seq: number;
}

/** Host side: mint the next request off the screen-lifetime counter ref. */
export function mintFocusRequest(counter: { current: number }, id: string): FocusRequest {
    counter.current += 1;
    return { id, seq: counter.current };
}

/** Map side: a request is actionable once; the caller marks handled only
 * after actually acting on it (target pin found, camera commanded). */
export function isUnhandledFocus(
    handledSeq: number | null,
    request: FocusRequest | null,
): request is FocusRequest {
    return request != null && handledSeq !== request.seq;
}
