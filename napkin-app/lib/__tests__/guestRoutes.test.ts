import { GUEST_ROUTE_GROUPS, resolveSignedOutRedirect } from '../guestRoutes';

const SEGMENTS: (string | undefined)[] = [
    undefined,
    '(tabs)',
    'restaurant',
    'auth',
    'reset-password',
    'settings',
    'entry-detail',
    'u',
    'list',
];

describe('resolveSignedOutRedirect', () => {
    it('keeps the pre-guest gate for a plain signed-out user (only auth + recovery stay)', () => {
        const expected: Record<string, '/auth' | null> = {
            undefined: '/auth',
            '(tabs)': '/auth',
            restaurant: '/auth',
            auth: null,
            'reset-password': null,
            settings: '/auth',
            'entry-detail': '/auth',
            u: '/auth',
            list: '/auth',
        };
        for (const segment of SEGMENTS) {
            expect(resolveSignedOutRedirect(segment, false)).toBe(expected[String(segment)]);
        }
    });

    it('lets a guest stay on the allowlisted groups and the root index, bounces everything else', () => {
        const expected: Record<string, '/auth' | null> = {
            undefined: null,
            '(tabs)': null,
            restaurant: null,
            auth: null,
            'reset-password': null,
            settings: '/auth',
            'entry-detail': '/auth',
            u: '/auth',
            list: '/auth',
        };
        for (const segment of SEGMENTS) {
            expect(resolveSignedOutRedirect(segment, true)).toBe(expected[String(segment)]);
        }
    });

    it('fails closed on unknown groups for both states', () => {
        expect(resolveSignedOutRedirect('not-a-route', true)).toBe('/auth');
        expect(resolveSignedOutRedirect('not-a-route', false)).toBe('/auth');
        expect(resolveSignedOutRedirect('', true)).toBe('/auth');
    });

    it('exposes exactly the four guest-reachable groups', () => {
        expect([...GUEST_ROUTE_GROUPS].sort()).toEqual(['(tabs)', 'auth', 'reset-password', 'restaurant']);
    });
});
