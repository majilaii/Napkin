/**
 * QueryClient test wrapper helpers — TICKET-042.
 *
 * Usage in a test file:
 *   jest.mock('@/providers/AuthProvider');
 *   jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
 *
 *   import { renderHookWithClient, makeTestClient } from '@/__tests__/utils/queryWrapper';
 *   import { mockEdgeFnResolves } from '@/__tests__/utils/mockEdgeFn';
 *
 *   it('...', async () => {
 *     const { result, client } = renderHookWithClient(() => useToggleReaction());
 *     client.setQueryData(key, initialState);
 *     mockEdgeFnResolves({ ... });
 *     act(() => result.current.mutate(input));
 *     await waitFor(() => expect(result.current.isSuccess).toBe(true));
 *     expect(client.getQueryData(key)).toMatchObject({ ... });
 *   });
 *
 * The wrapper provides only QueryClientProvider. Auth is mocked at the module
 * level via jest.mock('@/providers/AuthProvider') — see __mocks__/providers/AuthProvider.tsx.
 */

import React from 'react';
import { renderHook, type RenderHookOptions, type RenderHookResult } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Build a fresh QueryClient suitable for tests:
 * - retry: false   — don't retry on failures (tests want immediate rejection)
 * - gcTime: 0      — queries are cleaned up immediately after unmount
 * - staleTime: 0   — every query is immediately stale
 */
export function makeTestClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                gcTime: Infinity, // Don't GC during tests — no active subscribers but data must persist
                staleTime: 0,
            },
            mutations: {
                retry: false,
            },
        },
    });
}

export interface RenderHookWithClientOptions<P> extends Omit<RenderHookOptions<P>, 'wrapper'> {
    client?: QueryClient;
}

export interface RenderHookWithClientResult<P, R> extends RenderHookResult<R, P> {
    client: QueryClient;
}

/**
 * Wraps `renderHook` from @testing-library/react-native with a fresh
 * QueryClientProvider so hooks that call useQueryClient() work without
 * the real app providers.
 *
 * Auth is expected to be mocked via jest.mock('@/providers/AuthProvider')
 * at the top of each test file — the mock in __mocks__/providers/AuthProvider.tsx
 * provides a stable useAuth() returning { user: { id: 'test-user-id' } }.
 */
export function renderHookWithClient<P, R>(
    hook: (props: P) => R,
    opts: RenderHookWithClientOptions<P> = {},
): RenderHookWithClientResult<P, R> {
    const { client = makeTestClient(), ...rest } = opts;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>
            {children}
        </QueryClientProvider>
    );

    const hookResult = renderHook(hook, { ...rest, wrapper });
    return { ...hookResult, client };
}
