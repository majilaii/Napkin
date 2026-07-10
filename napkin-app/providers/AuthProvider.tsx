import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';

interface AuthContextType {
    session: Session | null;
    user: User | null;
    isLoading: boolean;
    /**
     * TICKET-107 onboarding gate — TRI-STATE so RootLayoutNav never flashes
     * /wishlist then bounces to /onboarding:
     *   undefined → not yet known (still loading the profile column; DON'T route)
     *   null      → needs onboarding (route to /onboarding)
     *   string    → already onboarded (the timestamp)
     */
    onboardedAt: string | null | undefined;
    /** Let the completion mutation flip the gate locally (optimistic release). */
    setOnboardedAt: (value: string | null) => void;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    // undefined = not yet loaded for the current user (gate must wait).
    const [onboardedAt, setOnboardedAt] = useState<string | null | undefined>(undefined);

    // Fetch the onboarding gate column for a user. Resets to `undefined` first so
    // the gate waits rather than acting on the previous user's value. Missing row
    // or error → treat as onboarded (never trap an existing user in onboarding).
    async function loadOnboardedAt(userId: string | null | undefined) {
        if (!userId) {
            setOnboardedAt(undefined);
            return;
        }
        setOnboardedAt(undefined);
        const { data, error } = await supabase
            .from('profiles')
            .select('onboarded_at')
            .eq('user_id', userId)
            .maybeSingle();
        if (error) {
            // Don't block the app on a read hiccup — treat as onboarded.
            setOnboardedAt(new Date(0).toISOString());
            return;
        }
        setOnboardedAt((data?.onboarded_at as string | null) ?? null);
    }

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setUser(session?.user ?? null);
            setIsLoading(false);
            loadOnboardedAt(session?.user?.id);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                setSession(session);
                setUser(session?.user ?? null);
                setIsLoading(false);
                loadOnboardedAt(session?.user?.id);
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    const signOut = async () => {
        await supabase.auth.signOut();
        // Clear all cached data to prevent user A seeing user B's data
        queryClient.removeQueries();
        setOnboardedAt(undefined);
    };

    return (
        <AuthContext.Provider
            value={{ session, user, isLoading, onboardedAt, setOnboardedAt, signOut }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
