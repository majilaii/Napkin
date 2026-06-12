/**
 * Pure helpers for rendering Google Places opening hours on the restaurant page
 * (TICKET-081). Kept dependency-free + side-effect-free so they're unit-testable.
 *
 * The `hours` payload mirrors what we persist to restaurants.hours (jsonb):
 *   { weekdayDescriptions: string[], openNow?: boolean }
 * where weekdayDescriptions has 7 entries and INDEX 0 IS MONDAY — the Places v1
 * `regularOpeningHours.weekdayDescriptions` convention. JS Date.getDay() is
 * 0=Sunday..6=Saturday, so we remap to a Monday-first index below.
 */

export type RestaurantHours = {
    weekdayDescriptions: string[];
    openNow?: boolean;
};

/**
 * Map a JS day-of-week (0=Sun..6=Sat) to the Places Monday-first index (0=Mon..6=Sun).
 *   Sun(0) → 6, Mon(1) → 0, Tue(2) → 1, ... Sat(6) → 5
 */
export function placesWeekdayIndex(jsDay: number): number {
    return (jsDay + 6) % 7;
}

/** True when the payload has at least one usable weekday description. */
export function hasHours(hours: RestaurantHours | null | undefined): boolean {
    return !!hours
        && Array.isArray(hours.weekdayDescriptions)
        && hours.weekdayDescriptions.some(d => typeof d === 'string' && d.trim() !== '');
}

/**
 * The raw weekday-description string for `date`'s day, or null if unavailable.
 * `date` defaults to now; injectable for testing.
 */
export function todaysHoursDescription(
    hours: RestaurantHours | null | undefined,
    date: Date = new Date(),
): string | null {
    if (!hasHours(hours)) return null;
    const idx = placesWeekdayIndex(date.getDay());
    const desc = hours!.weekdayDescriptions[idx];
    return typeof desc === 'string' && desc.trim() !== '' ? desc : null;
}

/**
 * Strip the leading "Monday: " day-name label from a Places weekday description,
 * leaving just the hours portion ("9:00 AM – 11:00 PM" or "Closed"). Places
 * formats each line as "<Day>: <hours>". If no label is found, returns the
 * string unchanged. Lowercased to match the journal voice on the page.
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
 * A single quiet line for today: e.g. "open now · 9:00 am – 11:00 pm" /
 * "closed · 9:00 am – 5:00 pm" (when openNow known) or just the hours otherwise.
 * Returns null when there are no hours for today — the caller omits the line.
 */
export function todaysHoursLine(
    hours: RestaurantHours | null | undefined,
    date: Date = new Date(),
): string | null {
    const desc = todaysHoursDescription(hours, date);
    if (desc == null) return null;
    const hoursText = stripDayLabel(desc).toLowerCase();
    if (hours?.openNow === undefined) return hoursText;
    const prefix = hours.openNow ? 'open now' : 'closed';
    return `${prefix} · ${hoursText}`;
}

/**
 * The full week, normalized to lowercase "<day> · <hours>" lines, in the same
 * Monday-first order Places returns. Today's line is flagged so the UI can mark
 * it. Empty array when no hours.
 */
export function weekHoursLines(
    hours: RestaurantHours | null | undefined,
    date: Date = new Date(),
): Array<{ day: string; hours: string; isToday: boolean }> {
    if (!hasHours(hours)) return [];
    const todayIdx = placesWeekdayIndex(date.getDay());
    return hours!.weekdayDescriptions
        .map((desc, i) => {
            if (typeof desc !== 'string' || desc.trim() === '') return null;
            const colon = desc.indexOf(':');
            const hasLabel = colon > 0 && colon <= 10;
            const day = hasLabel ? desc.slice(0, colon).trim().toLowerCase() : '';
            const hoursText = stripDayLabel(desc).toLowerCase();
            return { day, hours: hoursText, isToday: i === todayIdx };
        })
        .filter((x): x is { day: string; hours: string; isToday: boolean } => x !== null);
}
