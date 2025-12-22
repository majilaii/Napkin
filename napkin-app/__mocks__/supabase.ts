/**
 * Supabase client mock for testing
 * 
 * Usage in tests:
 * ```typescript
 * import { mockSupabase, mockUser } from '../__mocks__/supabase';
 * 
 * beforeEach(() => {
 *   mockSupabase.functions.invoke.mockResolvedValue({ data: {...} });
 * });
 * ```
 */

export const mockUser = {
    id: 'test-user-id-123',
    email: 'test@example.com',
    app_metadata: {},
    user_metadata: { display_name: 'Test User' },
    aud: 'authenticated',
    created_at: '2024-01-01T00:00:00Z',
};

export const mockSession = {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    expires_in: 3600,
    expires_at: Date.now() + 3600000,
    token_type: 'bearer',
    user: mockUser,
};

export const mockSupabase = {
    auth: {
        getSession: jest.fn().mockResolvedValue({ data: { session: mockSession }, error: null }),
        getUser: jest.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
        onAuthStateChange: jest.fn().mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } }),
        signInWithOAuth: jest.fn(),
        signOut: jest.fn(),
    },
    from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        upsert: jest.fn().mockReturnThis(),
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
    }),
    functions: {
        invoke: jest.fn().mockResolvedValue({ data: null, error: null }),
    },
    channel: jest.fn().mockReturnValue({
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn().mockReturnThis(),
        unsubscribe: jest.fn(),
    }),
};

// Default export mimics the actual supabase client import
export const supabase = mockSupabase;

// Jest mock for the module
jest.mock('@/lib/supabase', () => ({
    supabase: mockSupabase,
}));
