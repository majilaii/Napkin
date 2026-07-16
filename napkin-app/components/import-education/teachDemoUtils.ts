/**
 * Pure state machine + copy for the full-screen TikTok import walkthrough.
 *
 * Every transition is interaction-gated. Automated motion may reveal the next
 * target, but it never advances the tutorial for the user.
 */

export const BEAT_COUNT = 8;
export const LAST_BEAT = BEAT_COUNT - 1;

export type TeachTarget =
    | 'start'
    | 'share'
    | 'tiktokMore'
    | 'iosMore'
    | 'napkin'
    | 'addForReview'
    | 'approveAll';

/** The only accepted target at each non-terminal beat. */
export const REQUIRED_TARGETS: readonly TeachTarget[] = [
    'start',
    'share',
    'tiktokMore',
    'iosMore',
    'napkin',
    'addForReview',
    'approveAll',
];

/** Advance only when the intended control was tapped; every other tap is ignored. */
export function advanceOnTarget(beat: number, target: TeachTarget): number {
    if (beat < 0 || beat >= LAST_BEAT) return Math.max(0, Math.min(beat, LAST_BEAT));
    return REQUIRED_TARGETS[beat] === target ? beat + 1 : beat;
}

export const TEACH_COPY = {
    introTitle: 'Save this TikTok',
    introBody: 'Try the exact sharing flow once. Then every restaurant video is one tap from Napkin.',
    resultTitle: 'Saved from the whole video',
    resultBody: 'We watch the whole video — not just the caption.',
    startCta: 'Try it now',
    shareHint: 'Tap Share',
    tiktokMoreHint: 'Tap More',
    iosMoreHint: 'Tap More',
    napkinHint: 'Tap Napkin',
    doneCta: 'Start saving',
} as const;
