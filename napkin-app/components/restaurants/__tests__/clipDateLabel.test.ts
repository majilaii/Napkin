/**
 * ClippingCard date grammar (founder bug 2026-09-09).
 *
 * The ON SOCIALS attribution row used to read `clipped by you · last september`
 * for a clip saved the same day: the helper prefixed `last` unconditionally.
 * Pins the relative-month grammar. `now` is injected so the expectations never
 * drift with the calendar.
 */
import { clipDateLabel } from '../ClippingCard';

jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

// Local-time constructor: created_at is compared against `now` in device-local
// month/year, so build both the same way to keep the test timezone-agnostic.
const at = (y: number, m: number, d = 15) => new Date(y, m - 1, d, 12);
const iso = (y: number, m: number, d = 15) => at(y, m, d).toISOString();

describe('clipDateLabel', () => {
    const now = at(2026, 9, 9);

    it('reads `this <month>` for a clip from the current month', () => {
        expect(clipDateLabel(iso(2026, 9, 9), now)).toBe('this september');
        expect(clipDateLabel(iso(2026, 9, 1), now)).toBe('this september');
    });

    it('reads `last <month>` only for the immediately previous month', () => {
        expect(clipDateLabel(iso(2026, 8), now)).toBe('last august');
        expect(clipDateLabel(iso(2026, 7), now)).not.toBe('last july');
    });

    it('reads a bare `<month>` for earlier months of the current year', () => {
        expect(clipDateLabel(iso(2026, 7), now)).toBe('july');
        expect(clipDateLabel(iso(2026, 1), now)).toBe('january');
    });

    it('reads `<month> <year>` for a previous year', () => {
        expect(clipDateLabel(iso(2025, 9), now)).toBe('september 2025');
        expect(clipDateLabel(iso(2025, 3), now)).toBe('march 2025');
    });

    it('crosses the year boundary: december is `last december` in january', () => {
        const january = at(2027, 1, 5);
        expect(clipDateLabel(iso(2026, 12), january)).toBe('last december');
        expect(clipDateLabel(iso(2026, 11), january)).toBe('november 2026');
    });

    it('stays lowercase and returns an empty string for an unparseable date', () => {
        expect(clipDateLabel(iso(2026, 9), now)).toMatch(/^[a-z ]+$/);
        expect(clipDateLabel('not-a-date', now)).toBe('');
        expect(clipDateLabel('', now)).toBe('');
    });
});
