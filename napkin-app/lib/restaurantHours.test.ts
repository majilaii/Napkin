import {
    placesWeekdayIndex,
    hasHours,
    todaysHoursDescription,
    stripDayLabel,
    todaysHoursLine,
    weekHoursLines,
    type RestaurantHours,
} from './restaurantHours';

// Places convention: index 0 = Monday.
const WEEK: RestaurantHours = {
    weekdayDescriptions: [
        'Monday: 9:00 AM – 11:00 PM',
        'Tuesday: 9:00 AM – 11:00 PM',
        'Wednesday: 9:00 AM – 11:00 PM',
        'Thursday: 9:00 AM – 11:00 PM',
        'Friday: 9:00 AM – 12:00 AM',
        'Saturday: 10:00 AM – 12:00 AM',
        'Sunday: Closed',
    ],
};

// Fixed dates with known weekdays (UTC noon to dodge TZ edge flips).
const MONDAY = new Date('2026-06-08T12:00:00');    // getDay() === 1
const SUNDAY = new Date('2026-06-07T12:00:00');    // getDay() === 0
const SATURDAY = new Date('2026-06-13T12:00:00');  // getDay() === 6

describe('placesWeekdayIndex — JS day → Monday-first index', () => {
    it('maps Sunday(0) to 6, Monday(1) to 0, Saturday(6) to 5', () => {
        expect(placesWeekdayIndex(0)).toBe(6); // Sun
        expect(placesWeekdayIndex(1)).toBe(0); // Mon
        expect(placesWeekdayIndex(2)).toBe(1); // Tue
        expect(placesWeekdayIndex(6)).toBe(5); // Sat
    });
});

describe('hasHours', () => {
    it('true only when a usable description exists', () => {
        expect(hasHours(WEEK)).toBe(true);
        expect(hasHours(null)).toBe(false);
        expect(hasHours(undefined)).toBe(false);
        expect(hasHours({ weekdayDescriptions: [] })).toBe(false);
        expect(hasHours({ weekdayDescriptions: ['', '  '] })).toBe(false);
    });
});

describe('todaysHoursDescription — correct weekday mapping', () => {
    it('Monday selects index 0', () => {
        expect(todaysHoursDescription(WEEK, MONDAY)).toBe('Monday: 9:00 AM – 11:00 PM');
    });
    it('Sunday selects index 6 (last), NOT index 0', () => {
        expect(todaysHoursDescription(WEEK, SUNDAY)).toBe('Sunday: Closed');
    });
    it('Saturday selects index 5', () => {
        expect(todaysHoursDescription(WEEK, SATURDAY)).toBe('Saturday: 10:00 AM – 12:00 AM');
    });
    it('null when no hours', () => {
        expect(todaysHoursDescription(null, MONDAY)).toBeNull();
    });
});

describe('stripDayLabel', () => {
    it('removes the leading day label', () => {
        expect(stripDayLabel('Monday: 9:00 AM – 11:00 PM')).toBe('9:00 AM – 11:00 PM');
        expect(stripDayLabel('Sunday: Closed')).toBe('Closed');
    });
    it('leaves a label-less string intact', () => {
        expect(stripDayLabel('Open 24 hours')).toBe('Open 24 hours');
    });
    it('does not strip an embedded time colon when there is no day label', () => {
        // No early colon → returned unchanged (trimmed).
        expect(stripDayLabel('Open until 11:00 PM')).toBe('Open until 11:00 PM');
    });
});

describe('todaysHoursLine', () => {
    it('prefixes open now / closed when openNow is known', () => {
        expect(todaysHoursLine({ ...WEEK, openNow: true }, MONDAY))
            .toBe('open now · 9:00 am – 11:00 pm');
        expect(todaysHoursLine({ ...WEEK, openNow: false }, SUNDAY))
            .toBe('closed · closed');
    });
    it('shows just the hours when openNow is absent', () => {
        expect(todaysHoursLine(WEEK, MONDAY)).toBe('9:00 am – 11:00 pm');
    });
    it('null when no hours for today', () => {
        expect(todaysHoursLine(null, MONDAY)).toBeNull();
    });
});

describe('weekHoursLines', () => {
    it('returns 7 lowercase day/hours lines, flagging today', () => {
        const lines = weekHoursLines(WEEK, MONDAY);
        expect(lines).toHaveLength(7);
        expect(lines[0]).toEqual({ day: 'monday', hours: '9:00 am – 11:00 pm', isToday: true });
        expect(lines[6]).toEqual({ day: 'sunday', hours: 'closed', isToday: false });
        // Only one day flagged today.
        expect(lines.filter(l => l.isToday)).toHaveLength(1);
    });
    it('flags Sunday as today on a Sunday', () => {
        const lines = weekHoursLines(WEEK, SUNDAY);
        expect(lines[6].isToday).toBe(true);
        expect(lines[0].isToday).toBe(false);
    });
    it('empty array when no hours', () => {
        expect(weekHoursLines(null, MONDAY)).toEqual([]);
    });
});
