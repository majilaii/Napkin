/**
 * teachDemoUtils — pure beat logic + copy for TeachShareSheetDemo (TICKET-122).
 * JSX-free so the beat state machine + copy are unit-testable without the demo's
 * Reanimated import (mirrors the feed *Gate.ts convention).
 *
 * One onboarding step, four auto-advancing beats:
 *   0 — promise + an unmistakable short-form-video frame
 *   1 — coach the share action on the fake reel
 *   2 — coach Napkin in an in-app iOS share-sheet replica
 *   3 — show the extracted restaurants in the wishlist — terminal until CTA
 *
 * All beat copy is Manrope (benefit / instruction) per copy doctrine; the single
 * serif moment is teach.tsx's brandLine, NOT anything here.
 */

export const BEAT_COUNT = 4;
export const LAST_BEAT = BEAT_COUNT - 1;

/** Absolute offsets from t0 (ms) at which the stage crossfades to the next beat. */
export const BEAT_TIMINGS_MS = {
    promiseToShare: 2200,
    shareToSheet: 4700,
    sheetToResult: 7400,
} as const;

/** Advance one beat, clamped at the terminal beat (a tap past the end is a no-op). */
export function advanceBeat(beat: number): number {
    return Math.min(beat + 1, LAST_BEAT);
}

/** Exact demo strings (cut hard). Assert these verbatim in tests. */
export const TEACH_COPY = {
    promiseEyebrow: 'SAVE FROM YOUR FEED',
    promiseTitle: 'See a restaurant you love?',
    promiseBody: 'Send the video to Napkin. We find every place for you.',
    shareTitle: 'Tap share on the video',
    shareBody: 'It works from Instagram, TikTok and more.',
    sheetTitle: 'Then choose Napkin',
    sheetBody: 'Add Napkin to your favourites and it is always one tap away.',
    resultEyebrow: 'DONE IN SECONDS',
    resultTitle: 'Three places, already saved.',
    resultBody: 'We watch the whole video — not just the caption.',
    continueHint: 'Tap to continue',
    doneCta: 'Start saving',
} as const;
