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
    startCta: 'Try it now',
    shareHint: 'Tap Share',
    tiktokMoreHint: 'Tap More',
    iosMoreHint: 'Tap More',
    napkinHint: 'Tap Napkin',
    extensionTitle: 'save to napkin',
    extensionMeta: 'link ready',
    reviewTitle: 'review before saving',
    reviewBody: 'Nothing is saved until you review the import in Napkin.',
    addForReviewCta: 'add for review',
    addedTitle: 'added for review',
    addedMeta: "open Napkin when you're ready to check the spots",
    addedCta: 'added',
    extensionCaption: 'Nothing saves until you say so.',
    importsTitle: 'imports',
    importsCardTitle: '5 spots · ready to review',
    importsNames: 'Matchado · TSUJIRI · Frothee',
    importsMeta: 'from TikTok · @creator',
    importsBody: 'we watch the whole video, not just the caption.',
    approveAllCta: 'approve all 5',
    importsCaption: 'Your spots wait here.',
    resultKicker: 'NAPKIN',
    resultPageTitle: 'Wishlist',
    resultTitle: 'approved — pinned to your wishlist',
    doneCta: 'Start saving',
} as const;
