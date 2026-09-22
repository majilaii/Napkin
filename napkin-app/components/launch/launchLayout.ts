/**
 * Launch screen geometry, in points, measured from the centre of the screen.
 *
 * The native splash centres a SPLASH_WORDMARK_SIZE square image on the full
 * screen; the launch screen draws the same image in the same square, so the
 * handoff is pixel-identical. Everything else hangs off that square.
 *
 * Keep SPLASH_WORDMARK_SIZE in sync with `imageWidth` in app.config.ts and
 * `canvasPoints` in scripts/brand/render-splash-wordmark.swift (a test pins
 * the app config side).
 */
export const SPLASH_WORDMARK_SIZE = 200;

/** Where the rendered ink sits inside the square (from the render script). */
export const WORDMARK_INK = {
    width: 125.3,
    top: -15,
    baseline: 15,
    descender: 25.5,
} as const;

export const LAUNCH_LAYOUT = {
    /** Hairlines above and below the wordmark, like the auth masthead. */
    ruleOffset: 38,
    ruleWidth: 232,
    /** The pen stroke that runs along the lower rule while waiting. */
    nibWidth: 40,
    nibHeight: 1,
    /** Status line and retry sit below the masthead without moving it. */
    statusTop: 66,
    statusWidth: 280,
    retryMinWidth: 132,
    retryMinHeight: 48,
    /** How far the masthead lifts as it leaves. */
    exitLift: 10,
} as const;
