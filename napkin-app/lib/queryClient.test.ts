/**
 * Tests for lib/queryClient.ts — TICKET-121 global QueryCache/MutationCache
 * onError handlers. Observational only: report once, skip already-reported
 * and session-expiry errors, and never throw.
 */

jest.mock('@/lib/supabase', () => require('@/__mocks__/supabase'));
jest.mock('@/lib/track', () => ({ trackError: jest.fn() }));
jest.mock('@/lib/sentry', () => ({
    captureError: jest.fn(),
    addBreadcrumb: jest.fn(),
}));

import { queryClient } from './queryClient';
import { SessionExpiredError } from './edgeInvoke';
import { trackError } from '@/lib/track';
import { captureError } from '@/lib/sentry';

function fireQueryError(err: unknown, queryKey: unknown[]): void {
    const onError = queryClient.getQueryCache().config.onError;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError?.(err as Error, { queryKey } as any);
}

function fireMutationError(err: unknown, mutationKey?: unknown[]): void {
    const onError = queryClient.getMutationCache().config.onError;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError?.(err as Error, undefined, undefined, { options: { mutationKey } } as any, {} as any);
}

describe('queryClient global onError (TICKET-121)', () => {
    it('reports a query error with the stringified queryKey', () => {
        const err = new Error('load failed');
        fireQueryError(err, ['tables', 'list', 'u1']);

        expect(trackError).toHaveBeenCalledWith(err, 'query:["tables","list","u1"]');
        expect(captureError).toHaveBeenCalledWith(err, {
            context: 'query:["tables","list","u1"]',
        });
    });

    it('truncates very long queryKeys to 120 chars', () => {
        const err = new Error('load failed');
        fireQueryError(err, ['x'.repeat(400)]);

        const context = (trackError as jest.Mock).mock.calls[0][1] as string;
        expect(context.startsWith('query:')).toBe(true);
        expect(context.length).toBeLessThanOrEqual('query:'.length + 120);
    });

    it('reports a mutation error with its mutationKey, or anonymous', () => {
        const err = new Error('save failed');
        fireMutationError(err, ['wishlist', 'add']);
        expect(trackError).toHaveBeenCalledWith(err, 'mutation:["wishlist","add"]');

        (trackError as jest.Mock).mockClear();
        fireMutationError(err, undefined);
        expect(trackError).toHaveBeenCalledWith(err, 'mutation:anonymous');
    });

    it('skips errors already reported at the callEdgeFn choke point', () => {
        const err = new Error('boom') as Error & { __napkinReported?: boolean };
        err.__napkinReported = true;

        fireQueryError(err, ['tables', 'list']);
        fireMutationError(err, ['wishlist', 'add']);

        expect(trackError).not.toHaveBeenCalled();
        expect(captureError).not.toHaveBeenCalled();
    });

    it('skips SessionExpiredError — routine sign-out flow, not a defect', () => {
        const err = new SessionExpiredError();

        fireQueryError(err, ['tables', 'list']);
        fireMutationError(err, ['wishlist', 'add']);

        expect(trackError).not.toHaveBeenCalled();
        expect(captureError).not.toHaveBeenCalled();
    });

    it('never throws, even when reporting itself fails', () => {
        (trackError as jest.Mock).mockImplementation(() => {
            throw new Error('reporting exploded');
        });

        expect(() => fireQueryError(new Error('x'), ['k'])).not.toThrow();
        expect(() => fireMutationError(new Error('x'), ['k'])).not.toThrow();
    });

    it('keeps the existing defaultOptions untouched', () => {
        const defaults = queryClient.getDefaultOptions();
        expect(defaults.queries?.staleTime).toBe(1000 * 60 * 5);
        expect(defaults.queries?.gcTime).toBe(1000 * 60 * 30);
        expect(defaults.queries?.retry).toBe(2);
        expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    });
});
