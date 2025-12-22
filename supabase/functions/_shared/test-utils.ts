/**
 * Shared test utilities for Supabase Edge Function testing
 * 
 * Usage:
 * ```typescript
 * import { createMockRequest, createMockSupabase, mockEnv } from '../_shared/test-utils.ts';
 * 
 * Deno.test('my test', async () => {
 *   mockEnv();
 *   const req = createMockRequest('POST', { data: 'test' });
 *   // ... test your handler
 * });
 * ```
 */

import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';

export { assertEquals, assertExists };

/**
 * Mock environment variables for testing
 */
export function mockEnv() {
    Deno.env.set('SUPABASE_URL', 'https://test-project.supabase.co');
    Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
}

/**
 * Create a mock Request object
 */
export function createMockRequest(
    method: string,
    body?: Record<string, unknown>,
    headers: Record<string, string> = {}
): Request {
    const defaultHeaders: Record<string, string> = {
        'Authorization': 'Bearer test-token',
        'Content-Type': 'application/json',
        ...headers,
    };

    return new Request('http://localhost:8000', {
        method,
        headers: new Headers(defaultHeaders),
        body: body ? JSON.stringify(body) : undefined,
    });
}

/**
 * Mock user for auth testing
 */
export const mockUser = {
    id: 'test-user-id-123',
    email: 'test@example.com',
    app_metadata: {},
    user_metadata: { display_name: 'Test User' },
    aud: 'authenticated',
    created_at: '2024-01-01T00:00:00Z',
};

/**
 * Mock Supabase client factory for testing
 * Returns a mock that can be configured per-test
 */
export function createMockSupabaseClient() {
    const mockData: Record<string, unknown> = {};

    return {
        auth: {
            getUser: () => Promise.resolve({ data: { user: mockUser }, error: null }),
        },
        from: (table: string) => ({
            select: () => ({
                eq: () => ({
                    single: () => Promise.resolve({ data: mockData[table] ?? null, error: null }),
                    order: () => ({
                        limit: () => Promise.resolve({ data: [], error: null }),
                    }),
                }),
                order: () => ({
                    limit: () => Promise.resolve({ data: [], error: null }),
                }),
            }),
            insert: (data: unknown) => ({
                select: () => ({
                    single: () => Promise.resolve({ data: { id: 'new-id', ...data as object }, error: null }),
                }),
            }),
            update: (data: unknown) => ({
                eq: () => ({
                    select: () => ({
                        single: () => Promise.resolve({ data, error: null }),
                    }),
                }),
            }),
            delete: () => ({
                eq: () => Promise.resolve({ data: null, error: null }),
            }),
            upsert: (data: unknown) => ({
                select: () => ({
                    single: () => Promise.resolve({ data: { id: 'upsert-id', ...data as object }, error: null }),
                }),
            }),
        }),
        // Allow tests to set mock data
        _setMockData: (table: string, data: unknown) => {
            mockData[table] = data;
        },
    };
}

/**
 * Parse JSON response from edge function
 */
export async function parseResponse<T>(response: Response): Promise<T> {
    return await response.json() as T;
}

/**
 * Assert response status and parse body
 */
export async function assertResponse<T>(
    response: Response,
    expectedStatus: number
): Promise<T> {
    assertEquals(response.status, expectedStatus);
    return await parseResponse<T>(response);
}
