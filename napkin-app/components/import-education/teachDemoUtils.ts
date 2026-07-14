/**
 * Pure state machine, copy, and overlay geometry for the import walkthrough.
 *
 * Every transition is interaction-gated. Footage playback may reveal the next
 * target, but it never advances the tutorial for the user.
 *
 * The geometry helpers map normalized coordinates measured on the footage
 * frame (see assets/onboarding/teach/FOOTAGE.md) into container pixels for a
 * video rendered with contentFit "cover". They are pure so jest can pin them
 * without loading any native module or asset.
 */

export const BEAT_COUNT = 6;
export const LAST_BEAT = BEAT_COUNT - 1;

export type TeachTarget = 'start' | 'share' | 'tiktokMore' | 'iosMore' | 'napkin';

/** The only accepted target at each non-terminal beat. */
export const REQUIRED_TARGETS: readonly TeachTarget[] = [
    'start',
    'share',
    'tiktokMore',
    'iosMore',
    'napkin',
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
    shareCaption: "Let's save this TikTok to Napkin.",
    tiktokMoreCaption: "TikTok's own drawer comes up first.",
    iosMoreCaption: 'Now the iOS share sheet.',
    napkinCaption: 'There we are.',
    shareHint: 'Tap Share',
    tiktokMoreHint: 'Tap More',
    iosMoreHint: 'Tap More',
    napkinHint: 'Tap Napkin',
    resultTitle: 'Saved from the whole video',
    resultBody: 'We watch the whole video, not just the caption.',
    doneCta: 'Start saving',
} as const;

/** Where a tap target sits on the footage frame, in 0..1 frame coordinates. */
export type TeachTargetShape =
    | { kind: 'circle'; x: number; y: number; r: number } // r is normalized to frame WIDTH
    | { kind: 'rect'; x: number; y: number; w: number; h: number }; // centered on x,y

export interface CoverTransform {
    scale: number;
    displayedWidth: number;
    displayedHeight: number;
    offsetX: number;
    offsetY: number;
}

/** How a videoWidth x videoHeight frame maps into a container under contentFit "cover". */
export function coverTransform(
    videoWidth: number,
    videoHeight: number,
    containerWidth: number,
    containerHeight: number,
): CoverTransform {
    const scale = Math.max(containerWidth / videoWidth, containerHeight / videoHeight);
    const displayedWidth = videoWidth * scale;
    const displayedHeight = videoHeight * scale;
    return {
        scale,
        displayedWidth,
        displayedHeight,
        offsetX: (containerWidth - displayedWidth) / 2,
        offsetY: (containerHeight - displayedHeight) / 2,
    };
}

/** A normalized frame point in container pixels. */
export function mapVideoPoint(
    transform: CoverTransform,
    normalizedX: number,
    normalizedY: number,
): { x: number; y: number } {
    return {
        x: transform.offsetX + normalizedX * transform.displayedWidth,
        y: transform.offsetY + normalizedY * transform.displayedHeight,
    };
}

export interface SpotlightBox {
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
}

/** Container-pixel bounding box (plus corner radius) of a target's spotlight hole. */
export function spotlightBox(transform: CoverTransform, shape: TeachTargetShape): SpotlightBox {
    const center = mapVideoPoint(transform, shape.x, shape.y);
    if (shape.kind === 'circle') {
        const radius = shape.r * transform.displayedWidth;
        return {
            x: center.x - radius,
            y: center.y - radius,
            width: radius * 2,
            height: radius * 2,
            radius,
        };
    }
    const width = shape.w * transform.displayedWidth;
    const height = shape.h * transform.displayedHeight;
    return {
        x: center.x - width / 2,
        y: center.y - height / 2,
        width,
        height,
        radius: Math.min(18, height / 2),
    };
}

export interface MagnifierLayout {
    imageWidth: number;
    imageHeight: number;
    imageLeft: number;
    imageTop: number;
}

/**
 * Layout for the enlarged-crop callout: how large to render the frozen frame
 * inside a box of boxWidth x boxHeight so that a region focusW wide (normalized),
 * centered on focusX/focusY, exactly fills the box width.
 */
export function magnifierLayout(
    videoWidth: number,
    videoHeight: number,
    focusX: number,
    focusY: number,
    focusW: number,
    boxWidth: number,
    boxHeight: number,
): MagnifierLayout {
    const imageWidth = boxWidth / focusW;
    const imageHeight = imageWidth * (videoHeight / videoWidth);
    return {
        imageWidth,
        imageHeight,
        imageLeft: boxWidth / 2 - focusX * imageWidth,
        imageTop: boxHeight / 2 - focusY * imageHeight,
    };
}
