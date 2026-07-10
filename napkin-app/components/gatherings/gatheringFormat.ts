/**
 * gatheringFormat — the small pure date/name helpers shared by the gathering
 * surfaces (GatheringCard, GatheringDetail) and the view-model (TICKET-136).
 *
 * Lifted verbatim from GatheringCard so the card, the detail screen, and
 * useGatheringViewModel all format dates/names identically — no drift between the
 * feed card and its unfolded detail. No side effects; trivially testable.
 */
import type { GatheringSeat } from '@/hooks/tables/useTableActivity';

/** The counter/reschedule date window: strictly-future proposals within 90 days. */
export const MAX_DAYS_AHEAD = 90;

/** 'YYYY-MM-DD' → the calendar-leaf pieces ("SUN", "5", "JUL"). */
export function dateLeaf(ymd: string): { wd: string; day: string; mo: string } | null {
    const d = new Date(`${ymd}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return {
        wd: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
        day: String(d.getDate()),
        mo: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
    };
}

/**
 * 'YYYY-MM-DD' → a quiet relative-day phrase for the When row: "today" /
 * "tomorrow" / "in 3 days" / "yesterday" / "5 days ago". `now` is injectable so
 * the day-boundary math is deterministically testable. Empty string when
 * unparseable (the caller just renders nothing).
 */
export function relativeDay(ymd: string, now: Date = new Date()): string {
    const d = new Date(`${ymd}T00:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const delta = Math.round((d.getTime() - today.getTime()) / 86_400_000);
    if (delta === 0) return 'today';
    if (delta === 1) return 'tomorrow';
    if (delta === -1) return 'yesterday';
    return delta > 1 ? `in ${delta} days` : `${-delta} days ago`;
}

/** 'YYYY-MM-DD' → 'sat 12' (lowercase weekday + day) — the counter/meta grammar. */
export function shortDate(ymd: string): string {
    const d = new Date(`${ymd}T00:00:00`);
    if (Number.isNaN(d.getTime())) return ymd;
    const wd = d.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    return `${wd} ${d.getDate()}`;
}

/** Start of the day n days from now (device-local; the server re-validates HKT). */
export function dayFromNow(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(0, 0, 0, 0);
    return d;
}

/** Local-time YYYY-MM-DD (never toISOString — UTC can shift the day). */
export function toYMD(d: Date): string {
    return d.toLocaleDateString('en-CA');
}

/** First token of a display name (null-safe). */
export function firstName(name: string | null): string | null {
    if (!name) return null;
    return name.split(' ')[0] || null;
}

/** Viewer first (as "you"), then the host, then everyone else. */
export function orderSeats(rows: GatheringSeat[], viewerId?: string): GatheringSeat[] {
    const score = (s: GatheringSeat) => (s.user_id === viewerId ? 0 : s.is_host ? 1 : 2);
    return [...rows].sort((a, b) => score(a) - score(b));
}

/** "you, Clara +2" — up to two names, the rest counted. */
export function namesLine(rows: GatheringSeat[], viewerId?: string): string {
    const names: string[] = [];
    for (const s of rows) {
        if (names.length === 2) break;
        const n = s.user_id === viewerId ? 'you' : firstName(s.display_name);
        if (n) names.push(n);
    }
    const extra = rows.length - names.length;
    if (names.length === 0) return `${rows.length}`;
    return `${names.join(', ')}${extra > 0 ? ` +${extra}` : ''}`;
}
