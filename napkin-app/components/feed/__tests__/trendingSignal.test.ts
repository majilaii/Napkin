/**
 * TICKET-114 — trending signal-line term assembly (omit zero, fold saves+list
 * adds, max two terms).
 */
import { trendingSignal } from '../trendingSignal';

describe('trendingSignal', () => {
    it('leads with imports; folds saves + list adds into one "saved" count', () => {
        expect(trendingSignal({ imports_30d: 7, saves_30d: 9, list_adds_30d: 3 })).toBe(
            '7 imported · 12 saved',
        );
    });

    it('omits the imports term when there are no imports', () => {
        expect(trendingSignal({ imports_30d: 0, saves_30d: 4, list_adds_30d: 0 })).toBe('4 saved');
    });

    it('omits the saved term when saves and list adds are both zero', () => {
        expect(trendingSignal({ imports_30d: 5, saves_30d: 0, list_adds_30d: 0 })).toBe('5 imported');
    });

    it('list adds alone still surface under "saved"', () => {
        expect(trendingSignal({ imports_30d: 0, saves_30d: 0, list_adds_30d: 2 })).toBe('2 saved');
    });

    it('returns an empty string when every count is zero', () => {
        expect(trendingSignal({ imports_30d: 0, saves_30d: 0, list_adds_30d: 0 })).toBe('');
    });
});
