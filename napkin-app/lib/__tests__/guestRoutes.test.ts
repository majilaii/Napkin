import { GUEST_ROUTE_GROUPS, GUEST_TAB_ROUTES, resolveSignedOutRedirect } from '../guestRoutes';

type Case = [segments: string[], plain: '/auth' | null, guest: '/auth' | null];

// [segments, plain signed-out result, guest result]
const CASES: Case[] = [
    [[], '/auth', null],
    [['(tabs)', 'places'], '/auth', null],
    [['(tabs)', 'feed'], '/auth', null],
    [['(tabs)', 'tables'], '/auth', null],
    [['(tabs)', 'profile'], '/auth', null],
    [['(tabs)', 'search'], '/auth', null],
    [['(tabs)'], '/auth', null],
    [['(tabs)', 'journal'], '/auth', '/auth'],
    [['(tabs)', 'log'], '/auth', '/auth'],
    [['restaurant', '[id]'], '/auth', null],
    [['auth'], null, null],
    [['reset-password'], null, null],
    [['settings'], '/auth', '/auth'],
    [['entry-detail'], '/auth', '/auth'],
    [['u', '[identifier]'], '/auth', '/auth'],
    [['list', '[id]'], '/auth', null],
    [['list', 'new'], '/auth', '/auth'],
    [['list', '[id]', 'edit'], '/auth', '/auth'],
    [['list'], '/auth', '/auth'],
    [['places-scope'], '/auth', '/auth'],
    [['import'], '/auth', '/auth'],
    [['log-meal'], '/auth', '/auth'],
    [['onboarding'], '/auth', '/auth'],
];

describe('resolveSignedOutRedirect', () => {
    it.each(CASES)('%j: plain signed-out -> %s, guest -> %s', (segments, plain, guest) => {
        expect(resolveSignedOutRedirect(segments, false)).toBe(plain);
        expect(resolveSignedOutRedirect(segments, true)).toBe(guest);
    });

    it('fails closed on unknown groups and unknown tabs for both states', () => {
        expect(resolveSignedOutRedirect(['not-a-route'], true)).toBe('/auth');
        expect(resolveSignedOutRedirect(['not-a-route'], false)).toBe('/auth');
        expect(resolveSignedOutRedirect([''], true)).toBe('/auth');
        expect(resolveSignedOutRedirect(['(tabs)', 'not-a-tab'], true)).toBe('/auth');
    });

    it('exposes exactly the guest-reachable groups and tabs', () => {
        expect([...GUEST_ROUTE_GROUPS].sort()).toEqual(['(tabs)', 'auth', 'list', 'reset-password', 'restaurant']);
        expect([...GUEST_TAB_ROUTES].sort()).toEqual(['feed', 'places', 'profile', 'search', 'tables']);
    });
});
