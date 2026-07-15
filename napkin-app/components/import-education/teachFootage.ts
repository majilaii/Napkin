/**
 * Footage manifest for the import walkthrough.
 *
 * Each beat plays a bundled clip of the REAL flow (TikTok -> iOS share sheet ->
 * Napkin -> share-extension confirm), freezes on its decision frame, and
 * spotlights the tap target at the normalized coordinates below.
 *
 * The clips were cut from a real recording (July 2026, iPhone Pro Max) with the
 * status bar cropped off and privacy blur baked into the two bands that showed
 * real contacts (TikTok drawer recipients, iOS AirDrop row). Cut points, blur
 * bands, and the coordinate-measurement method are documented in
 * assets/onboarding/teach/FOOTAGE.md - a re-record is file-for-file.
 *
 * Kept separate from teachDemoUtils.ts so jest never resolves asset requires.
 */
import { TEACH_COPY, type TeachTarget, type TeachTargetShape } from './teachDemoUtils';

export interface TeachFootageBeat {
    /** State-machine token this beat's tap emits. */
    target: Exclude<TeachTarget, 'start'>;
    /** Bundled clip that plays, then freezes on its last frame. */
    video: number;
    /** Exact last frame of the clip; shown while frozen and in reduced motion. */
    still: number;
    /** Pixel dimensions of the clip, so overlay math survives re-exports. */
    videoWidth: number;
    videoHeight: number;
    /** Clip length; drives the stall watchdog, not playback. */
    durationMs: number;
    /** Typewriter line shown while the clip plays. */
    caption: string;
    /** Coach pill text on the frozen frame. */
    hint: string;
    /** Where the coach pill sits relative to the spotlight. */
    pill: 'left' | 'above';
    /** Tap target on the frame, normalized 0..1 (see FOOTAGE.md for measuring). */
    shape: TeachTargetShape;
    /** Optional enlarged-crop callout for small targets. */
    magnifier?: { focusX: number; focusY: number; focusW: number };
}

export const TEACH_FOOTAGE: readonly TeachFootageBeat[] = [
    {
        target: 'share',
        video: require('../../assets/onboarding/teach/teach-1-share.mp4'),
        still: require('../../assets/onboarding/teach/teach-1-share-still.png'),
        videoWidth: 646,
        videoHeight: 1344,
        durationMs: 3850,
        caption: TEACH_COPY.shareCaption,
        hint: TEACH_COPY.shareHint,
        pill: 'left',
        shape: { kind: 'circle', x: 0.927, y: 0.748, r: 0.055 },
    },
    {
        target: 'tiktokMore',
        video: require('../../assets/onboarding/teach/teach-2-tiktok-more.mp4'),
        still: require('../../assets/onboarding/teach/teach-2-tiktok-more-still.png'),
        videoWidth: 646,
        videoHeight: 1344,
        durationMs: 1550,
        caption: TEACH_COPY.tiktokMoreCaption,
        hint: TEACH_COPY.tiktokMoreHint,
        pill: 'left',
        shape: { kind: 'circle', x: 0.893, y: 0.79, r: 0.055 },
    },
    {
        target: 'iosMore',
        video: require('../../assets/onboarding/teach/teach-3-ios-more.mp4'),
        still: require('../../assets/onboarding/teach/teach-3-ios-more-still.png'),
        videoWidth: 646,
        videoHeight: 1344,
        durationMs: 2650,
        caption: TEACH_COPY.iosMoreCaption,
        hint: TEACH_COPY.iosMoreHint,
        pill: 'left',
        shape: { kind: 'circle', x: 0.822, y: 0.757, r: 0.055 },
        // The app-icon row is tiny on frame; echo it enlarged above the spotlight.
        magnifier: { focusX: 0.51, focusY: 0.757, focusW: 0.78 },
    },
    {
        target: 'napkin',
        video: require('../../assets/onboarding/teach/teach-4-apps-napkin.mp4'),
        still: require('../../assets/onboarding/teach/teach-4-apps-napkin-still.png'),
        videoWidth: 646,
        videoHeight: 1344,
        durationMs: 1950,
        caption: TEACH_COPY.napkinCaption,
        hint: TEACH_COPY.napkinHint,
        pill: 'above',
        shape: { kind: 'rect', x: 0.495, y: 0.432, w: 0.905, h: 0.057 },
    },
    {
        target: 'addForReview',
        video: require('../../assets/onboarding/teach/teach-5-add-review.mp4'),
        still: require('../../assets/onboarding/teach/teach-5-add-review-still.png'),
        videoWidth: 646,
        videoHeight: 1344,
        durationMs: 1650,
        caption: TEACH_COPY.addForReviewCaption,
        hint: TEACH_COPY.addForReviewHint,
        pill: 'above',
        shape: { kind: 'rect', x: 0.499, y: 0.898, w: 0.85, h: 0.058 },
    },
];

/** Footage for beats 1..5; null for the intro (0) and the native result (6). */
export function footageForBeat(beat: number): TeachFootageBeat | null {
    return beat >= 1 && beat <= TEACH_FOOTAGE.length ? TEACH_FOOTAGE[beat - 1] : null;
}
