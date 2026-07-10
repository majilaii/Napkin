/**
 * teachDemoUtils — pure beat logic + copy for TeachShareSheetDemo (TICKET-122).
 * JSX-free so the beat state machine + copy are unit-testable without the demo's
 * Reanimated import (mirrors the feed *Gate.ts convention).
 *
 * One onboarding step, three auto-advancing beats:
 *   0 — benefit ("we watch the whole video…")
 *   1 — animated in-app share-sheet replica (tap share → tap napkin)
 *   2 — pro-tip (add napkin to share favourites) — terminal, holds until Done
 *
 * All beat copy is Manrope (benefit / instruction) per copy doctrine; the single
 * serif moment is teach.tsx's brandLine, NOT anything here.
 */

export const BEAT_COUNT = 3;
export const LAST_BEAT = BEAT_COUNT - 1;

/** Absolute offsets from t0 (ms) at which the stage crossfades to the next beat. */
export const BEAT_TIMINGS_MS = {
    beat1To2: 2400, // hold Beat 1 ~2.4s
    beat2To3: 5400, // hold Beat 2 ~3s
} as const;

/** Advance one beat, clamped at the terminal beat (a tap past the end is a no-op). */
export function advanceBeat(beat: number): number {
    return Math.min(beat + 1, LAST_BEAT);
}

/** Exact demo strings (cut hard). Assert these verbatim in tests. */
export const TEACH_COPY = {
    kicker: 'the good part',
    brandLine: 'save from anywhere', // the ONE serif moment on the screen
    benefit: 'we watch the whole video — not just the caption.',
    tapShare: 'tap share',
    tapNapkin: 'tap napkin',
    proTip: 'add napkin to your share favourites — one tap next time.',
} as const;
