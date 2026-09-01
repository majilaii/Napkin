import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
import { searchLocalityStore } from '@/hooks/search/searchLocalityStore';

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
    /** Let the completion mutation reconcile the gate after server confirmation. */
    setOnboardedAt: (value: string | null) => void;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const PROFILE_GATE_RETRY_DELAYS_MS = [250, 750] as const;

export type OnboardingGateRead =
    | { status: 'resolved'; value: string | null }
    | { status: 'unresolved' };

/**
 * Read the route gate with bounded retry. Exhaustion is deliberately represented
 * as unresolved rather than a synthetic timestamp: the caller must keep routing
 * blocked until a later auth event/remount can establish the real profile state.
 */
export async function readOnboardingGateWithRetry(
    userId: string,
): Promise<OnboardingGateRead> {
    for (let attempt = 0; attempt <= PROFILE_GATE_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('onboarded_at')
                .eq('user_id', userId)
                .maybeSingle();

            if (!error) {
                return {
                    status: 'resolved',
                    value: (data?.onboarded_at as string | null) ?? null,
                };
            }
        } catch {
            // Transport throws are the same unresolved read as a Supabase error
            // envelope. Retry below, then remain checking after exhaustion.
        }

        const delayMs = PROFILE_GATE_RETRY_DELAYS_MS[attempt];
        if (delayMs !== undefined) {
            await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }
    }
    return { status: 'unresolved' };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    // undefined = not yet loaded for the current user (gate must wait).
    const [onboardedAt, setOnboardedAtState] = useState<string | null | undefined>(undefined);
    const gateReadGeneration = useRef(0);

    // Server-confirmed completion must win over any profile read that began
    // before the mutation committed. Invalidating the read generation here
    // prevents its stale null snapshot from sending the user back to S1.
    const setOnboardedAt = useCallback((value: string | null) => {
        gateReadGeneration.current += 1;
        setOnboardedAtState(value);
    }, []);

    // Fetch the onboarding gate column for a user. Resets to `undefined` first so
    // the gate waits rather than acting on the previous user's value. Missing row
    // or error → remain unresolved/checking (never fail open past onboarding).
    async function loadOnboardedAt(userId: string | null | undefined) {
        const generation = ++gateReadGeneration.current;
        if (!userId) {
            setOnboardedAtState(undefined);
            return;
        }
        setOnboardedAtState(undefined);
        const result = await readOnboardingGateWithRetry(userId);
        if (gateReadGeneration.current !== generation) return;
        if (result.status === 'resolved') {
            setOnboardedAtState(result.value);
        }
    }

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            searchLocalityStore.setActiveUser(session?.user?.id);
            setSession(session);
            setUser(session?.user ?? null);
            setIsLoading(false);
            loadOnboardedAt(session?.user?.id);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                searchLocalityStore.setActiveUser(session?.user?.id);
                setSession(session);
                setUser(session?.user ?? null);
                setIsLoading(false);
                loadOnboardedAt(session?.user?.id);
            }
        );

        return () => {
            gateReadGeneration.current += 1;
            subscription.unsubscribe();
        };
    }, []);

    const signOut = async () => {
        gateReadGeneration.current += 1;
        await supabase.auth.signOut();
        searchLocalityStore.setActiveUser(null);
        // Clear all cached data to prevent user A seeing user B's data
        queryClient.removeQueries();
        setOnboardedAtState(undefined);
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
