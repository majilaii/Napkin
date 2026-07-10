/**
 * permissionLabel unit tests — TICKET-142 settings permission pill.
 *
 * Pins the load-bearing rule: only an explicit OS "granted" reads On; every
 * other status (denied / undetermined / restricted / unknown / null) reads Off,
 * so a not-yet-granted permission never masquerades as enabled.
 */
import { permissionOn, permissionPill } from '../permissionLabel';

describe('permissionOn', () => {
    it('is true only for an explicit grant', () => {
        expect(permissionOn('granted')).toBe(true);
    });

    it('is false for every non-granted status', () => {
        for (const s of ['denied', 'undetermined', 'restricted', 'unknown', '', null, undefined]) {
            expect(permissionOn(s)).toBe(false);
        }
    });
});

describe('permissionPill', () => {
    it('grants → an On/positive pill', () => {
        expect(permissionPill('granted')).toEqual({ label: 'On', tone: 'positive' });
    });

    it('denied / undetermined / null → an Off/muted pill', () => {
        for (const s of ['denied', 'undetermined', null, undefined]) {
            expect(permissionPill(s)).toEqual({ label: 'Off', tone: 'muted' });
        }
    });
});
