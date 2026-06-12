/**
 * Pure helpers for rendering Google Places opening hours on the restaurant page
 * (TICKET-081). Kept dependency-free + side-effect-free so they're unit-testable.
 *
 * The `hours` payload mirrors what we persist to restaurants.hours (jsonb):
 *   { weekdayDescriptions: string[] }
 *
 * Two deliberate decisions (TICKET-081 fix-pass, Codex HIGH):
 *
 *  1. NO `openNow`. Places' `regularOpeningHours.openNow` is a POINT-IN-TIME flag
 *     (true only at the instant Places served it). We persist `hours` to the DB and
 *     re-read it for weeks, so a stored open/closed claim is stale and wrong. We
 *     never store it and never render a live open/closed badge.
 *
 *  2. We do NOT index `weekdayDescriptions` by position. The array order is
 *     LOCALE-DEPENDENT — different locales start the week on a different day, so a
 *     hardcoded "index 0 = Monday" assumption can surface the wrong day. Instead we
 *     request Places in a fixed locale (languageCode=en → English, deterministic day
 *     names) and derive "today" by MATCHING the current weekday's English name
 *     against the leading day-label of each description string. No match → no
 *     "today" highlight (graceful: the full week still renders).
 */

export type RestaurantHours = {
    weekdayDescriptions: string[];
};

/** English weekday names indexed by JS `Date.getDay()` (0=Sunday..6=Saturday). */
const EN_WEEKDAYS = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
] as const;

/** True when the payload has at least one usable weekday description. */
export function hasHours(hours: RestaurantHours | null | undefined): boolean {
    return !!hours
        && Array.isArray(hours.weekdayDescriptions)
        && hours.weekdayDescriptions.some(d => typeof d === 'string' && d.trim() !== '');
}

/**
 * The raw weekday-description string whose leading day-label matches `date`'s
 * English weekday name, or null if there's no matching line (e.g. a non-English
 * locale slipped through, or descriptions are malformed). `date` defaults to now;
 * injectable for testing.
 *
 * Matching is case-insensitive and anchored to the start of the trimmed string so
 * an embedded weekday word inside an hours range can't false-match.
 */
export function todaysHoursDescription(
    hours: RestaurantHours | null | undefined,
    date: Date = new Date(),
): string | null {
    if (!hasHours(hours)) return null;
    const todayName = EN_WEEKDAYS[date.getDay()].toLowerCase();
    for (const desc of hours!.weekdayDescriptions) {
        if (typeof desc !== 'string') continue;
        const trimmed = desc.trim();
        if (trimmed.toLowerCase().startsWith(todayName)) return trimmed;
    }
    return null;
}

/**
 * Strip the leading "Monday: " day-name label from a Places weekday description,
 * leaving just the hours portion ("9:00 AM – 11:00 PM" or "Closed"). Places
 * formats each line as "<Day>: <hours>". If no label is found, returns the
 * string unchanged. Lowercased by callers to match the journal voice on the page.
 */
export function stripDayLabel(description: string): string {
    const colon = description.indexOf(':');
    // Day labels are short ("Wednesday: " ≤ 11 chars before the colon). Only strip
    // when the colon is early enough to be a day name, not an embedded time colon.
    if (colon > 0 && colon <= 10) {
        return description.slice(colon + 1).trim();
    }
    return description.trim();
}

/**
 * A single quiet line for today: just the lowercased hours text, e.g.
 * "9:00 am – 11:00 pm" / "closed". Returns null when there's no matching line for
 * today — the caller omits the line entirely (and may fall back to the full week).
 *
 * No open/closed prefix: we have no trustworthy live-status signal (see file header).
 */
export function todaysHoursLine(
    hours: RestaurantHours | null | undefined,
    date: Date = new Date(),
): string | null {
    const desc = todaysHoursDescription(hours, date);
    if (desc == null) return null;
    return stripDayLabel(desc).toLowerCase();
}

/**
 * The full week, normalized to lowercase "<day> · <hours>" lines, in whatever
 * order Places returned them (we don't reorder — order is locale-defined). Today's
 * line is flagged by day-name match so the UI can mark it; if nothing matches,
 * no line is flagged. Empty array when no hours.
 */
export function weekHoursLines(
    hours: RestaurantHours | null | undefined,
    date: Date = new Date(),
): Array<{ day: string; hours: string; isToday: boolean }> {
    if (!hasHours(hours)) return [];
    const todayName = EN_WEEKDAYS[date.getDay()].toLowerCase();
    return hours!.weekdayDescriptions
        .map((desc) => {
            if (typeof desc !== 'string' || desc.trim() === '') return null;
            const trimmed = desc.trim();
            const colon = trimmed.indexOf(':');
            const hasLabel = colon > 0 && colon <= 10;
            const day = hasLabel ? trimmed.slice(0, colon).trim().toLowerCase() : '';
            const hoursText = stripDayLabel(trimmed).toLowerCase();
            // Match today by day-name prefix — never by array position.
            const isToday = trimmed.toLowerCase().startsWith(todayName);
            return { day, hours: hoursText, isToday };
        })
        .filter((x): x is { day: string; hours: string; isToday: boolean } => x !== null);
}
