/**
 * teachDemoUtils — pure beat logic + copy for TeachShareSheetDemo (TICKET-122).
 * JSX-free so the beat state machine + copy are unit-testable without the demo's
 * Reanimated import (mirrors the feed *Gate.ts convention).
 *
 * One onboarding step, four interaction-gated beats:
 *   0 — promise + an unmistakable short-form-video frame
 *   1 — user MUST tap share on the fake reel
 *   2 — user MUST tap Napkin in an in-app iOS share-sheet replica
 *   3 — show the extracted restaurants in the wishlist — terminal until CTA
 *
 * All beat copy is Manrope (benefit / instruction) per copy doctrine; the single
 * serif moment is teach.tsx's brandLine, NOT anything here.
 */

export const BEAT_COUNT = 4;
export const LAST_BEAT = BEAT_COUNT - 1;

export type TeachTarget = 'start' | 'share' | 'napkin';

/** The only accepted target at each non-terminal beat. */
export const REQUIRED_TARGETS: readonly TeachTarget[] = ['start', 'share', 'napkin'];

/** Advance only when the intended control was tapped; every other tap is ignored. */
export function advanceOnTarget(beat: number, target: TeachTarget): number {
    if (beat < 0 || beat >= LAST_BEAT) return Math.max(0, Math.min(beat, LAST_BEAT));
    return REQUIRED_TARGETS[beat] === target ? beat + 1 : beat;
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
    startCta: 'Practice it',
    shareHint: 'Tap the highlighted share button',
    napkinHint: 'Tap the Napkin icon',
    doneCta: 'Start saving',
} as const;
