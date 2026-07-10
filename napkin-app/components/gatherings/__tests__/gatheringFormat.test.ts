/**
 * gatheringFormat unit tests — the pure date helpers behind the gathering
 * surfaces. Focused on relativeDay (TICKET-148 When row), whose day-boundary
 * math must ignore the current time-of-day and survive month rollovers.
 */
import { relativeDay } from '../gatheringFormat';

describe('relativeDay', () => {
    // A Friday afternoon — the time-of-day must NOT leak into the day delta.
    const now = new Date('2026-07-10T14:30:00');

    it('names today / tomorrow / yesterday', () => {
        expect(relativeDay('2026-07-10', now)).toBe('today');
        expect(relativeDay('2026-07-11', now)).toBe('tomorrow');
        expect(relativeDay('2026-07-09', now)).toBe('yesterday');
    });

    it('future dates → "in N days" (counted from the START of today)', () => {
        expect(relativeDay('2026-07-12', now)).toBe('in 2 days');
        expect(relativeDay('2026-07-17', now)).toBe('in 7 days');
    });

    it('past dates → "N days ago"', () => {
        expect(relativeDay('2026-07-05', now)).toBe('5 days ago');
    });

    it('crosses a month boundary correctly', () => {
        expect(relativeDay('2026-08-01', new Date('2026-07-30T23:00:00'))).toBe('in 2 days');
    });

    it('is empty for an unparseable date', () => {
        expect(relativeDay('not-a-date', now)).toBe('');
    });
});
