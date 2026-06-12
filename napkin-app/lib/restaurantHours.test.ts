import {
    hasHours,
    todaysHoursDescription,
    stripDayLabel,
    todaysHoursLine,
    weekHoursLines,
    type RestaurantHours,
} from './restaurantHours';

// English Places descriptions. Order is whatever the locale returns — we match by
// day-name prefix, never by index, so the array order here is intentionally not
// assumed to mean anything.
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

// Fixed dates with known weekdays (noon to dodge TZ edge flips).
const MONDAY = new Date('2026-06-08T12:00:00');    // getDay() === 1
const SUNDAY = new Date('2026-06-07T12:00:00');    // getDay() === 0
const SATURDAY = new Date('2026-06-13T12:00:00');  // getDay() === 6
const WEDNESDAY = new Date('2026-06-10T12:00:00'); // getDay() === 3

describe('hasHours', () => {
    it('true only when a usable description exists', () => {
        expect(hasHours(WEEK)).toBe(true);
        expect(hasHours(null)).toBe(false);
        expect(hasHours(undefined)).toBe(false);
        expect(hasHours({ weekdayDescriptions: [] })).toBe(false);
        expect(hasHours({ weekdayDescriptions: ['', '  '] })).toBe(false);
    });
});

describe('todaysHoursDescription — matches by day-name, not array position', () => {
    it('Monday selects the line starting with "Monday"', () => {
        expect(todaysHoursDescription(WEEK, MONDAY)).toBe('Monday: 9:00 AM – 11:00 PM');
    });
    it('Sunday selects the "Sunday" line wherever it sits', () => {
        expect(todaysHoursDescription(WEEK, SUNDAY)).toBe('Sunday: Closed');
    });
    it('Saturday selects the "Saturday" line', () => {
        expect(todaysHoursDescription(WEEK, SATURDAY)).toBe('Saturday: 10:00 AM – 12:00 AM');
    });
    it('finds the correct day even when the array is rotated (Sunday-first order)', () => {
        const rotated: RestaurantHours = {
            weekdayDescriptions: [
                'Sunday: Closed',
                'Monday: 9:00 AM – 11:00 PM',
                'Tuesday: 9:00 AM – 11:00 PM',
                'Wednesday: 8:00 AM – 10:00 PM',
                'Thursday: 9:00 AM – 11:00 PM',
                'Friday: 9:00 AM – 12:00 AM',
                'Saturday: 10:00 AM – 12:00 AM',
            ],
        };
        // Index 0 here is Sunday — a positional reader would return the wrong day.
        expect(todaysHoursDescription(rotated, WEDNESDAY)).toBe('Wednesday: 8:00 AM – 10:00 PM');
    });
    it('case-insensitive match', () => {
        const lower: RestaurantHours = { weekdayDescriptions: ['monday: 9–5', 'tuesday: 9–5'] };
        expect(todaysHoursDescription(lower, MONDAY)).toBe('monday: 9–5');
    });
    it('null when no line matches today (e.g. non-English locale)', () => {
        const french: RestaurantHours = {
            weekdayDescriptions: ['lundi: 09:00 – 23:00', 'mardi: 09:00 – 23:00'],
        };
        expect(todaysHoursDescription(french, MONDAY)).toBeNull();
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

describe('todaysHoursLine — quiet hours text, NO open/closed prefix', () => {
    it('returns just the lowercased hours for today', () => {
        expect(todaysHoursLine(WEEK, MONDAY)).toBe('9:00 am – 11:00 pm');
    });
    it('returns "closed" on a closed day (no prefix, no doubling)', () => {
        expect(todaysHoursLine(WEEK, SUNDAY)).toBe('closed');
    });
    it('null when today does not match any line', () => {
        const french: RestaurantHours = { weekdayDescriptions: ['lundi: 09:00 – 23:00'] };
        expect(todaysHoursLine(french, MONDAY)).toBeNull();
    });
    it('null when no hours', () => {
        expect(todaysHoursLine(null, MONDAY)).toBeNull();
    });
});

describe('weekHoursLines', () => {
    it('returns lowercase day/hours lines, flagging today by name match', () => {
        const lines = weekHoursLines(WEEK, MONDAY);
        expect(lines).toHaveLength(7);
        expect(lines[0]).toEqual({ day: 'monday', hours: '9:00 am – 11:00 pm', isToday: true });
        expect(lines[6]).toEqual({ day: 'sunday', hours: 'closed', isToday: false });
        // Exactly one day flagged today.
        expect(lines.filter(l => l.isToday)).toHaveLength(1);
    });
    it('flags Sunday as today on a Sunday regardless of position', () => {
        const lines = weekHoursLines(WEEK, SUNDAY);
        expect(lines.find(l => l.day === 'sunday')?.isToday).toBe(true);
        expect(lines.find(l => l.day === 'monday')?.isToday).toBe(false);
    });
    it('flags nothing when no day matches today (non-English locale)', () => {
        const french: RestaurantHours = {
            weekdayDescriptions: ['lundi: 09:00 – 23:00', 'mardi: 09:00 – 23:00'],
        };
        const lines = weekHoursLines(french, MONDAY);
        expect(lines).toHaveLength(2);
        // The crux: NO line is flagged today, because the day-name match is against
        // English names ("Monday") and these are French — so no stale wrong-day flag.
        expect(lines.filter(l => l.isToday)).toHaveLength(0);
        // The "lundi:" label still parses as a day cell (the renderer is locale-agnostic
        // about display) — we just never claim it's *today*.
        expect(lines[0].day).toBe('lundi');
    });
    it('empty array when no hours', () => {
        expect(weekHoursLines(null, MONDAY)).toEqual([]);
    });
});
