/**
 * importTruncation — the single source of truth for the "first N of M" honesty
 * line shown when a Maps list import is capped (MAPS_LIST_CAP = 20 server-side)
 * but the list actually held more spots (TICKET-151).
 *
 * Pure + unit-tested so the conditional-render rule lives in ONE place: both the
 * drain toast (auto mode) and the /import-review header call this, and the jest
 * test pins every edge case (null / undefined / NaN / ≤shown → no line).
 */

/**
 * The "first {shownCount} of {listCount}" line, or null when nothing was
 * truncated (or this isn't a list import at all).
 *
 *   truncationNote(117, 20) -> 'first 20 of 117'
 *   truncationNote(20, 20)  -> null   (no "20 of 20" noise)
 *   truncationNote(null, 20)-> null   (non-list import / pre-change manifest)
 *
 * @param listCount  the resolver's TRUE item count for the source list, or
 *                   null/undefined for a non-list import (TikTok/IG/video/place).
 * @param shownCount how many candidates we actually kept + persisted — the honest
 *                   numerator, NOT a hardcoded cap, so it stays truthful when
 *                   auto-mode filtering shrinks the batch.
 */
export function truncationNote(
    listCount: number | null | undefined,
    shownCount: number,
): string | null {
    // Non-list imports (null/undefined) and any garbage (NaN/±Infinity from a
    // corrupt or pre-change manifest) → no line, and never emit "NaN" copy.
    if (listCount == null || !Number.isFinite(listCount)) return null;
    // Nothing was cut (≤20 list) → stay quiet; no "20 of 20".
    if (listCount <= shownCount) return null;
    return `first ${shownCount} of ${listCount}`;
}
