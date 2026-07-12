/**
 * teachDemoUtils — pure beat logic + copy for TeachShareSheetDemo (TICKET-122).
 * JSX-free so the beat state machine + copy are unit-testable without the demo's
 * Reanimated import (mirrors the feed *Gate.ts convention).
 *
 * One onboarding step, five interaction-gated beats:
 *   0 — introduce the realistic practice flow
 *   1 — user MUST tap share on the fake reel
 *   2 — user MUST tap "Share to..." in the platform share drawer
 *   3 — user MUST tap Napkin in the iOS share-sheet replica
 *   4 — show the extracted restaurants in the wishlist — terminal until CTA
 *
 * All beat copy is Manrope (benefit / instruction) per copy doctrine; the single
 * serif moment is teach.tsx's brandLine, NOT anything here.
 */

export const BEAT_COUNT = 5;
export const LAST_BEAT = BEAT_COUNT - 1;

export type TeachTarget = 'start' | 'share' | 'shareTo' | 'napkin';

/** The only accepted target at each non-terminal beat. */
export const REQUIRED_TARGETS: readonly TeachTarget[] = ['start', 'share', 'shareTo', 'napkin'];

/** Advance only when the intended control was tapped; every other tap is ignored. */
export function advanceOnTarget(beat: number, target: TeachTarget): number {
    if (beat < 0 || beat >= LAST_BEAT) return Math.max(0, Math.min(beat, LAST_BEAT));
    return REQUIRED_TARGETS[beat] === target ? beat + 1 : beat;
}

/** Exact demo strings (cut hard). Assert these verbatim in tests. */
export const TEACH_COPY = {
    introTitle: 'Save this restaurant video',
    introBody: 'Try the exact flow you will use from Reels or TikTok.',
    resultTitle: 'Saved from the whole video',
    resultBody: 'We watch the whole video — not just the caption.',
    startCta: 'Try it now',
    shareHint: 'Tap Share',
    shareToHint: 'Tap Share to...',
    napkinHint: 'Tap Napkin',
    doneCta: 'Start saving',
} as const;
