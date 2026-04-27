/**
 * MockAuthProvider — provides a stable useAuth() context for hook tests.
 * TICKET-042.
 *
 * Usage:
 *   <MockAuthProvider userId="user-123">
 *     <YourComponent />
 *   </MockAuthProvider>
 *
 * Hooks that call useAuth() will receive { user: { id: userId }, session: null, ... }.
 */

import React, { createContext, useContext } from 'react';
import type { User, Session } from '@supabase/supabase-js';

// Mirrors the shape exported by @/providers/AuthProvider
interface AuthContextType {
    session: Session | null;
    user: User | null;
    isLoading: boolean;
    signOut: () => Promise<void>;
}

// Re-export the same AuthContext so hooks that import from the real
// AuthProvider path still get the right context. We achieve this by
// mocking the module in jest.setup.js or per-test; the Provider here
// is the test-side injection point.
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function MockAuthProvider({
    children,
    userId = 'test-user-id',
}: {
    children: React.ReactNode;
    userId?: string;
}) {
    const value: AuthContextType = {
        session: null,
        user: { id: userId } as User,
        isLoading: false,
        signOut: async () => {},
    };
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Drop-in replacement for useAuth() inside test renders. */
export function useMockAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useMockAuth must be used within MockAuthProvider');
    return ctx;
}
