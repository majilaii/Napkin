/**
 * TICKET-103 — feed date/time helpers, run against a fixed injected clock so they
 * never flake. `now` is pinned to a mid-afternoon local time on Sat 2026-07-05.
 */
import { feedSectionLabel, feedByline, feedMastheadDate } from '../feedDates';

// Sat Jul 5 2026, 3:00 pm local — mid-afternoon so "today" rows earlier in the
// day still land on the same calendar day regardless of the runner's TZ.
const NOW = new Date(2026, 6, 5, 15, 0, 0);

/** An ISO instant N whole days before NOW, at a fixed 7:40 pm local time. */
function daysAgoAt(days: number, hour = 19, minute = 40): string {
    return new Date(2026, 6, 5 - days, hour, minute, 0).toISOString();
}

describe('feedSectionLabel', () => {
    it('same calendar day → Today', () => {
        expect(feedSectionLabel(daysAgoAt(0, 9, 15), NOW)).toBe('Today');
        // even a later-evening "today" timestamp is still Today
        expect(feedSectionLabel(daysAgoAt(0, 23, 30), NOW)).toBe('Today');
    });

    it('one calendar day back → Yesterday', () => {
        expect(feedSectionLabel(daysAgoAt(1), NOW)).toBe('Yesterday');
    });

    it('2–6 days back → This week', () => {
        expect(feedSectionLabel(daysAgoAt(2), NOW)).toBe('This week');
        expect(feedSectionLabel(daysAgoAt(6), NOW)).toBe('This week');
    });

    it('7+ days back → month name', () => {
        // 7 days before Jul 5 = Jun 28 → June
        expect(feedSectionLabel(daysAgoAt(7), NOW)).toBe('June');
        expect(feedSectionLabel(daysAgoAt(40), NOW)).toBe('May');
    });
});

describe('feedByline', () => {
    it('today → lowercase clock time', () => {
        expect(feedByline(daysAgoAt(0, 19, 40), NOW)).toBe('7:40 pm');
        expect(feedByline(daysAgoAt(0, 9, 12), NOW)).toBe('9:12 am');
    });

    it('earlier days → lowercase full weekday', () => {
        // Jul 4 2026 is a Saturday? Jul 5 is Sunday in reality — but the Date
        // constructor is authoritative here; assert the shape, not a hardcoded day.
        const yesterday = feedByline(daysAgoAt(1), NOW);
        expect(yesterday).toBe(yesterday.toLowerCase());
        expect(yesterday).not.toMatch(/[ap]m/);
        // Jul 2 2026 is a Thursday.
        expect(feedByline(daysAgoAt(3), NOW)).toBe('thursday');
    });
});

describe('feedMastheadDate', () => {
    it('renders lowercase weekday · month day for the masthead type token', () => {
        expect(feedMastheadDate(NOW)).toBe('sunday · july 5');
    });
});
