/**
 * Tests for lib/edgeInvoke.ts — TICKET-075 401 refresh-retry decision.
 *
 * Focused on the pure `isAuthFailure` predicate that gates the single
 * refresh+retry in callEdgeFn. The actual retry orchestration is exercised
 * end-to-end in the app; here we lock the classification logic so a future
 * change can't silently start (or stop) treating an error as an auth failure.
 *
 * testEnvironment: node. supabase is mocked so the module imports cleanly.
 */

jest.mock('@/lib/supabase', () => require('@/__mocks__/supabase'));

import { isAuthFailure, SessionExpiredError } from './edgeInvoke';

// Build an Error carrying the structured `.cause: UnwrappedError` that
// throwInvokeError attaches.
function errWithCause(cause: { code?: string; message?: string; status?: number }): Error {
    const e = new Error(cause.message ?? 'edge error') as Error & { cause?: unknown };
    e.cause = cause;
    return e;
}

describe('isAuthFailure', () => {
    it('true when cause.status is 401', () => {
        expect(isAuthFailure(errWithCause({ code: 'http_401', message: 'HTTP 401', status: 401 }))).toBe(true);
    });

    it('true for http_401 / 401 codes regardless of status field', () => {
        expect(isAuthFailure(errWithCause({ code: 'http_401', message: 'x' }))).toBe(true);
        expect(isAuthFailure(errWithCause({ code: '401', message: 'x' }))).toBe(true);
    });

    it('true for invalid-JWT / unauthorized codes', () => {
        expect(isAuthFailure(errWithCause({ code: 'invalid_jwt', message: 'bad token' }))).toBe(true);
        expect(isAuthFailure(errWithCause({ code: 'UNAUTHORIZED', message: 'nope' }))).toBe(true);
    });

    it('true when the message says invalid/expired JWT even without a code', () => {
        expect(isAuthFailure(errWithCause({ message: 'invalid JWT' }))).toBe(true);
        expect(isAuthFailure(errWithCause({ message: 'JWT expired' }))).toBe(true);
    });

    it('false for non-auth structured errors', () => {
        expect(isAuthFailure(errWithCause({ code: 'table_not_authorized', message: 'no', status: 403 }))).toBe(false);
        expect(isAuthFailure(errWithCause({ code: 'http_500', message: 'boom', status: 500 }))).toBe(false);
        expect(isAuthFailure(errWithCause({ code: 'NETWORK', message: 'offline' }))).toBe(false);
    });

    it('false for a bare error with no cause', () => {
        expect(isAuthFailure(new Error('something generic'))).toBe(false);
        expect(isAuthFailure(undefined)).toBe(false);
        expect(isAuthFailure(null)).toBe(false);
    });

    it('matches a top-level invalid-JWT message even without a cause', () => {
        expect(isAuthFailure(new Error('Invalid JWT'))).toBe(true);
    });
});

describe('SessionExpiredError', () => {
    it('carries the session_expired code for app-side routing', () => {
        const e = new SessionExpiredError();
        expect(e.code).toBe('session_expired');
        expect(e).toBeInstanceOf(Error);
        expect(e.message.length).toBeGreaterThan(0);
    });

    it('accepts a custom message', () => {
        const e = new SessionExpiredError('custom copy');
        expect(e.message).toBe('custom copy');
        expect(e.code).toBe('session_expired');
    });
});
