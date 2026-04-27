/**
 * Test mock for @/providers/AuthProvider.
 * Used by jest.mock('@/providers/AuthProvider') in hook test files.
 * TICKET-042.
 *
 * Default viewerId is 'test-user-id'. Override via mockUseAuth() helper.
 */

import React from 'react';
import type { User, Session } from '@supabase/supabase-js';

let _mockUserId = 'test-user-id';

export function setMockUserId(id: string) {
    _mockUserId = id;
}

export function resetMockUserId() {
    _mockUserId = 'test-user-id';
}

export function useAuth() {
    return {
        session: null as Session | null,
        user: { id: _mockUserId } as User,
        isLoading: false,
        signOut: jest.fn(),
    };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
