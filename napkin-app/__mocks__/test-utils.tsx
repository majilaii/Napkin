/**
 * React Query test utilities
 * 
 * Provides a wrapper for testing hooks that use React Query.
 * 
 * Usage:
 * ```typescript
 * import { renderHook, waitFor } from '@testing-library/react-native';
 * import { createQueryWrapper } from '../__mocks__/test-utils';
 * 
 * const { result } = renderHook(() => useTables(), {
 *   wrapper: createQueryWrapper(),
 * });
 * 
 * await waitFor(() => expect(result.current.isSuccess).toBe(true));
 * ```
 */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Creates a fresh QueryClient for each test to prevent state leakage
 */
export function createTestQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                gcTime: 0,
                staleTime: 0,
            },
            mutations: {
                retry: false,
            },
        },
    });
}

/**
 * Wrapper component for testing hooks that use React Query
 */
export function createQueryWrapper() {
    const queryClient = createTestQueryClient();

    return function QueryWrapper({ children }: { children: React.ReactNode }) {
        return (
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        );
    };
}

/**
 * Reset all mocks between tests
 */
export function resetAllMocks() {
    jest.clearAllMocks();
    jest.resetAllMocks();
}
