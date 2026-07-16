/**
 * Tests for lib/edgeInvoke.ts POST invoke-path action routing (TICKET-121 follow-up).
 *
 * A top-level `action` must reach the QUERY STRING on the POST invoke path,
 * mirroring the GET and postWithFetch paths — so functions that route POST on
 * `?action=` (e.g. table-management, index.ts:51) work whether the caller passes
 * `action` at the top level OR via `params: { action }`. `action` is also kept
 * in the body so body-reading functions are unaffected. Closes the misroute
 * footgun behind the "Name is required" fire (top_four_get/set, mark_welcomed).
 */

jest.mock('@/lib/supabase', () => require('@/__mocks__/supabase'));
jest.mock('@/lib/track', () => ({ trackError: jest.fn() }));
jest.mock('@/lib/sentry', () => ({
    addBreadcrumb: jest.fn(),
    captureError: jest.fn(),
}));

import { callEdgeFn } from './edgeInvoke';
import { mockSupabase } from '@/__mocks__/supabase';

describe('callEdgeFn POST action routing (TICKET-121 follow-up)', () => {
    beforeEach(() => {
        mockSupabase.functions.invoke.mockReset();
        mockSupabase.functions.invoke.mockResolvedValue({ data: { data: { ok: true } }, error: null });
    });

    it('sends a binary POST body without JSON encoding and preserves query auth', async () => {
        const previousUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
        const previousKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
        process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://project.test';
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
        const bytes = new Uint8Array([0xff, 0xd8, 0xff]).buffer;
        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ data: { state: 'staged' } }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }),
        );

        try {
            await expect(callEdgeFn('moderate-image', {
                action: 'finish_stage',
                params: { staging_path: 'image-staging/u/x', generation: 2 },
                rawBody: bytes,
                contentType: 'image/jpeg',
                signal: new AbortController().signal,
            })).resolves.toEqual({ state: 'staged' });

            const [url, init] = fetchSpy.mock.calls[0];
            const parsed = new URL(String(url));
            expect(parsed.searchParams.get('action')).toBe('finish_stage');
            expect(parsed.searchParams.get('staging_path')).toBe('image-staging/u/x');
            expect(parsed.searchParams.get('generation')).toBe('2');
            expect(init).toMatchObject({
                method: 'POST',
                body: bytes,
                headers: {
                    'Content-Type': 'image/jpeg',
                    Authorization: 'Bearer mock-access-token',
                    apikey: 'anon-key',
                },
            });
        } finally {
            fetchSpy.mockRestore();
            if (previousUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
            else process.env.EXPO_PUBLIC_SUPABASE_URL = previousUrl;
            if (previousKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
            else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = previousKey;
        }
    });

    it('puts a top-level action in the query string AND the body', async () => {
        await callEdgeFn('table-management', {
            action: 'top_four_get',
            body: { table_id: 't1' },
        });

        // Query string is what table-management reads (url.searchParams.get('action')).
        expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('table-management?action=top_four_get', {
            body: { action: 'top_four_get', table_id: 't1' },
        });
    });

    it('merges a top-level action with explicit params in the query string', async () => {
        await callEdgeFn('table-management', {
            action: 'top_four_get',
            params: { table_id: 't1' },
        });

        const [invokeName] = mockSupabase.functions.invoke.mock.calls[0];
        const q = new URL(`https://x/${invokeName}`).searchParams;
        expect(q.get('action')).toBe('top_four_get');
        expect(q.get('table_id')).toBe('t1');
    });

    it('leaves the function name bare when neither action nor params are passed', async () => {
        await callEdgeFn('table-activity', { body: { cursor: null } });

        expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('table-activity', {
            body: { cursor: null },
        });
    });

    it('still routes the params-only pattern unchanged (existing callers)', async () => {
        await callEdgeFn('table-management', {
            params: { action: 'mark_seen' },
            body: { table_id: 't1' },
        });

        // No top-level action → body carries no `action` key; query carries it.
        expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('table-management?action=mark_seen', {
            body: { table_id: 't1' },
        });
    });

    it('unwraps the data field by default', async () => {
        mockSupabase.functions.invoke.mockResolvedValue({
            data: { data: [{ id: 'w1' }], next_cursor: 'cursor-2' },
            error: null,
        });

        await expect(callEdgeFn('wishlist', { action: 'list_personal' })).resolves.toEqual([
            { id: 'w1' },
        ]);
    });

    it('preserves a pagination envelope when unwrapping is disabled', async () => {
        mockSupabase.functions.invoke.mockResolvedValue({
            data: { data: [{ id: 'w1' }], next_cursor: 'cursor-2' },
            error: null,
        });

        await expect(
            callEdgeFn('wishlist', { action: 'list_personal', unwrapData: false }),
        ).resolves.toEqual({
            data: [{ id: 'w1' }],
            next_cursor: 'cursor-2',
        });
    });
});
