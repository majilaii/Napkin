/**
 * TICKET-103 — hand-rolled feed date/time helpers (the repo has no date library).
 *
 * The feed groups rows under date headers, so the byline never carries a
 * relative "2h ago" / "5d" chatter — a journal remembers days, not minutes.
 *
 *   - feedSectionLabel(iso) → the day-cluster header: 'Today' | 'Yesterday' |
 *     'This week' | weekday-or-month for older rows (matches mockup `.dhdr`).
 *   - feedByline(iso) → the per-row stamp the header contextualizes: a clock
 *     time for today ('7:40 pm'), else the lowercase weekday ('tuesday').
 *   - masthead uses feedMastheadDate(now) → 'saturday · july 5'; its type token
 *     supplies the mock's uppercase rendering (computed client-side, no data).
 *
 * `now` is injectable so the unit tests run against a fixed clock and never flake.
 */

const DAY_MS = 86_400_000;

/** Local midnight for a given date (drops the time-of-day). */
function startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole calendar-days between two instants (local time), a→b positive if b earlier. */
function dayDelta(from: Date, to: Date): number {
    return Math.round((startOfDay(from).getTime() - startOfDay(to).getTime()) / DAY_MS);
}

/**
 * Day-cluster header label for an entry.
 *   0 days → 'Today', 1 day → 'Yesterday', within this week → 'This week',
 *   else the month name (e.g. 'March').
 */
export function feedSectionLabel(iso: string, now: Date = new Date()): string {
    const d = new Date(iso);
    const delta = dayDelta(now, d);
    if (delta <= 0) return 'Today';
    if (delta === 1) return 'Yesterday';
    if (delta < 7) return 'This week';
    return d.toLocaleDateString('en-US', { month: 'long' });
}

/**
 * Per-row byline stamp, contextualized by the section header above it.
 *   today → a clock time ('7:40 pm'); any earlier grouped day → the lowercase
 *   weekday ('tuesday'). Never a relative "2h"/"5d" style.
 */
export function feedByline(iso: string, now: Date = new Date()): string {
    const d = new Date(iso);
    if (dayDelta(now, d) <= 0) {
        return d
            .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            .toLowerCase();
    }
    return d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
}

/** Lowercase masthead source line, e.g. 'saturday · july 5'. */
export function feedMastheadDate(now: Date = new Date()): string {
    const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
    const month = now.toLocaleDateString('en-US', { month: 'long' });
    return `${weekday} · ${month} ${now.getDate()}`.toLocaleLowerCase();
}
