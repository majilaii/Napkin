/**
 * Tests for lib/edgeInvoke.ts — TICKET-121 choke-point reporting.
 *
 * Terminal failures (the ones that reach the caller) must be reported once
 * (trackError + captureError) and marked __napkinReported so the global
 * QueryCache/MutationCache handlers skip them. SessionExpiredError is the
 * routine sign-out path and must never be reported. Error shapes, the 401
 * refresh-retry flow, and the response envelope are untouched.
 */

jest.mock('@/lib/supabase', () => require('@/__mocks__/supabase'));
jest.mock('@/lib/track', () => ({ trackError: jest.fn() }));
jest.mock('@/lib/sentry', () => ({
    addBreadcrumb: jest.fn(),
    captureError: jest.fn(),
}));

import { callEdgeFn, SessionExpiredError } from './edgeInvoke';
import { mockSupabase } from '@/__mocks__/supabase';
import { trackError } from '@/lib/track';
import { addBreadcrumb, captureError } from '@/lib/sentry';
import { FunctionsFetchError } from '@supabase/supabase-js';

describe('callEdgeFn reporting (TICKET-121)', () => {
    it('adds an edge breadcrumb per call', async () => {
        mockSupabase.functions.invoke.mockResolvedValue({
            data: { data: { ok: true } },
            error: null,
        });

        await callEdgeFn('wishlist', { action: 'add', body: { restaurant_id: 'r1' } });

        expect(addBreadcrumb).toHaveBeenCalledWith({
            category: 'edge',
            message: 'wishlist:add',
        });
    });

    it('reports a terminal non-auth failure and marks __napkinReported', async () => {
        mockSupabase.functions.invoke.mockResolvedValue({
            data: { error: { code: 'SERVER_ERROR', message: 'boom' } },
            error: null,
        });

        let caught: unknown;
        try {
            await callEdgeFn('wishlist', { action: 'add' });
        } catch (err) {
            caught = err;
        }

        expect(caught).toBeInstanceOf(Error);
        expect((caught as { __napkinReported?: boolean }).__napkinReported).toBe(true);
        expect(trackError).toHaveBeenCalledTimes(1);
        expect(trackError).toHaveBeenCalledWith(caught, 'edge:wishlist:add');
        expect(captureError).toHaveBeenCalledWith(caught, {
            context: 'edge:wishlist:add',
            tags: { fn: 'wishlist', action: 'add', code: 'SERVER_ERROR', status: '' },
        });
    });

    it('does not report an expected device-network failure', async () => {
        mockSupabase.functions.invoke.mockResolvedValue({
            data: null,
            error: new FunctionsFetchError(new TypeError('Network request failed')),
        });

        let caught: unknown;
        try {
            await callEdgeFn('wishlist', { action: 'list_personal' });
        } catch (err) {
            caught = err;
        }

        expect(caught).toMatchObject({
            message: 'Couldn’t reach Napkin. Check your connection and try again.',
            cause: { code: 'NETWORK' },
            __napkinReported: true,
        });
        expect(trackError).not.toHaveBeenCalled();
        expect(captureError).not.toHaveBeenCalled();
    });

    it('preserves the structured .cause envelope on reported errors', async () => {
        mockSupabase.functions.invoke.mockResolvedValue({
            data: { error: { code: 'SERVER_ERROR', message: 'boom', details: { hint: 'x' } } },
            error: null,
        });

        await expect(callEdgeFn('wishlist', { action: 'add' })).rejects.toMatchObject({
            message: 'boom',
            cause: { code: 'SERVER_ERROR', message: 'boom' },
        });
    });

    it('never reports SessionExpiredError (401 + failed refresh)', async () => {
        // http_401 → auth failure; the mock has no auth.refreshSession, so the
        // refresh attempt fails and callEdgeFn throws SessionExpiredError.
        mockSupabase.functions.invoke.mockResolvedValue({
            data: { error: { code: 'http_401', message: 'HTTP 401' } },
            error: null,
        });

        await expect(callEdgeFn('tables', { action: 'list' })).rejects.toBeInstanceOf(
            SessionExpiredError,
        );
        expect(trackError).not.toHaveBeenCalled();
        expect(captureError).not.toHaveBeenCalled();
    });

    it('omits the action segment cleanly when no action is passed', async () => {
        mockSupabase.functions.invoke.mockResolvedValue({
            data: { error: { code: 'SERVER_ERROR', message: 'boom' } },
            error: null,
        });

        await expect(callEdgeFn('table-activity')).rejects.toThrow('boom');
        expect(trackError).toHaveBeenCalledWith(expect.any(Error), 'edge:table-activity:');
    });
});
