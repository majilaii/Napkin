/**
 * mealSlots — pure functions for day-logger slot logic.
 * No schema changes; slot derivation is from visited_at hour bucket.
 *
 * Slot hour buckets (local time):
 *   breakfast = 4–10 (exclusive of 11)
 *   lunch     = 11–15 (exclusive of 16)
 *   dinner    = 16–23
 *   overnight = 0–3 → maps to dinner of the PRIOR calendar day
 *
 * Spec says: "overnight (1am) gets assigned to prior day's dinner — spec says this is correct."
 */

export type MealSlot = 'breakfast' | 'lunch' | 'dinner';

/** Default local times for each slot (hours in 24h format). */
export const SLOT_DEFAULT_HOURS: Record<MealSlot, number> = {
    breakfast: 9,
    lunch: 13,
    dinner: 20,
};

/**
 * Derive the meal slot from a local-time hour (0–23).
 * Hour is local — callers must pass a local hour, not UTC.
 */
export function slotForHour(hour: number): MealSlot {
    if (hour >= 4 && hour < 11) return 'breakfast';
    if (hour >= 11 && hour < 16) return 'lunch';
    return 'dinner'; // 16–23 and overnight (0–3) both map to dinner
}

/**
 * Build an ISO timestamp string for a given calendar date + slot default time,
 * using the device's local timezone.
 *
 * date: YYYY-MM-DD string
 * slot: 'breakfast' | 'lunch' | 'dinner'
 * Returns ISO string (local-midnight-anchored, no UTC shift).
 */
export function defaultTimeForSlot(slot: MealSlot, date: string): string {
    return toLocalISO(date, SLOT_DEFAULT_HOURS[slot], 0);
}

/**
 * Build a local ISO timestamp from a YYYY-MM-DD string + hour + minute.
 * This is timezone-safe: uses the device's local offset, so "2026-04-22T09:00:00"
 * is stored as local time, not UTC midnight.
 *
 * IMPORTANT: do not inline Date math — always call this helper.
 */
export function toLocalISO(date: string, hour: number, minute: number): string {
    const [year, month, day] = date.split('-').map(Number);
    const d = new Date(year, month - 1, day, hour, minute, 0, 0);
    // Build a local ISO string manually to avoid UTC conversion
    const pad = (n: number, len = 2) => String(n).padStart(len, '0');
    return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Format a YYYY-MM-DD date string for display on the day-page masthead.
 * Returns lowercase, e.g. "thu, apr 22" or "today" / "yesterday".
 */
export function formatDayLabel(dateStr: string): { primary: string; isToday: boolean; isYesterday: boolean } {
    const today = getTodayDateStr();
    const yesterday = getYesterdayDateStr();

    if (dateStr === today) {
        return { primary: 'today', isToday: true, isYesterday: false };
    }
    if (dateStr === yesterday) {
        return { primary: 'yesterday', isToday: false, isYesterday: true };
    }

    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    const monthName = d.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
    return { primary: `${dayName}, ${monthName} ${day}`, isToday: false, isYesterday: false };
}

/** Returns today as YYYY-MM-DD in local time. */
export function getTodayDateStr(): string {
    return localDateStr(new Date());
}

/** Returns yesterday as YYYY-MM-DD in local time. */
export function getYesterdayDateStr(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return localDateStr(d);
}

/** Convert a Date to YYYY-MM-DD in local time. */
export function localDateStr(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Given a list of entries and a YYYY-MM-DD date string, return a record
 * mapping each slot to the first entry that falls in that slot.
 *
 * Overnight entries (hour 0–3) are mapped to the PRIOR day's dinner slot,
 * so they will NOT appear on `date` — they appear on (date - 1 day).
 *
 * Entries without a valid visited_at are ignored.
 */
export interface SlotEntry {
    slot: MealSlot;
    entryId: string;
    restaurantName: string;
    rating: number | null;
    content: string | null;
    visitedAt: string;
}

export function mapEntriesToSlots(
    entries: Array<{
        id: string;
        visited_at: string | null;
        restaurants: { name: string } | null;
        rating: number | null;
        content: string | null;
    }>,
    date: string,
): Partial<Record<MealSlot, SlotEntry>> {
    const result: Partial<Record<MealSlot, SlotEntry>> = {};

    for (const entry of entries) {
        if (!entry.visited_at) continue;

        const visitedDate = new Date(entry.visited_at);
        if (isNaN(visitedDate.getTime())) continue;

        const localHour = visitedDate.getHours();
        const entryLocalDate = localDateStr(visitedDate);

        // Overnight (0–3) → assign to prior day's dinner
        let effectiveDate = entryLocalDate;
        let effectiveSlot: MealSlot;

        if (localHour >= 0 && localHour < 4) {
            // Prior day dinner
            const prior = new Date(visitedDate);
            prior.setDate(prior.getDate() - 1);
            effectiveDate = localDateStr(prior);
            effectiveSlot = 'dinner';
        } else {
            effectiveSlot = slotForHour(localHour);
        }

        if (effectiveDate !== date) continue;

        // First entry per slot wins
        if (!result[effectiveSlot]) {
            result[effectiveSlot] = {
                slot: effectiveSlot,
                entryId: entry.id,
                restaurantName: entry.restaurants?.name ?? 'somewhere',
                rating: entry.rating,
                content: entry.content,
                visitedAt: entry.visited_at,
            };
        }
    }

    return result;
}
