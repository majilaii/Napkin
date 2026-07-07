/**
 * useHasImported signal tests (TICKET-122).
 *
 * The hook OR's two signals: the durable AsyncStorage flag (module-cached, seeds
 * the initial render synchronously) and useRecentImports (server back-compat). The
 * pure combine is exported so the OR truth-table is unit-testable without rendering
 * the hook / standing up react-query (repo convention: extract the pure gate).
 */
import { combineHasImported } from '../hasImportedSignal';

describe('combineHasImported', () => {
    it('false when neither signal is set', () => {
        expect(combineHasImported(false, 0)).toBe(false);
        expect(combineHasImported(false, undefined)).toBe(false);
    });

    it('true from the durable flag alone (even with zero server-known imports)', () => {
        expect(combineHasImported(true, 0)).toBe(true);
        expect(combineHasImported(true, undefined)).toBe(true);
    });

    it('true from recentImports.length > 0 alone (back-compat fallback)', () => {
        expect(combineHasImported(false, 1)).toBe(true);
        expect(combineHasImported(false, 4)).toBe(true);
    });

    it('true when both signals agree', () => {
        expect(combineHasImported(true, 3)).toBe(true);
    });
});
