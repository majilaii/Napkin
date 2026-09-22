import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
import { searchLocalityStore } from '@/hooks/search/searchLocalityStore';
import { searchCache } from '@/hooks/search/searchCache';
import { placesScreenState } from '@/hooks/search/placesScreenState';
import { setImportPushOwner, unlinkImportPushDevice, watchImportPushRegistration } from '@/lib/importPush';
import { setBackgroundImportOwner, unlinkBackgroundImportIntake } from '@/lib/backgroundImportIntake';
import { readGuestMode, writeGuestMode } from '@/lib/guestMode';

interface AuthContextType {
    session: Session | null;
    user: User | null;
    /** True until BOTH the initial getSession() and the guest flag read resolve. */
    isLoading: boolean;
    /**
     * TICKET-247 guest mode: signed out, but allowed on the public routes
     * (see lib/guestRoutes). Cleared by any auth event that carries a session
     * and by signOut(), so an account never lands in guest mode.
     */
    isGuest: boolean;
    enterGuestMode: () => Promise<void>;
    exitGuestMode: () => Promise<void>;
    /**
     * TICKET-107 onboarding gate — TRI-STATE so RootLayoutNav never flashes
     * the default signed-in route then bounces to /onboarding:
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
    const [isGuest, setIsGuest] = useState(false);
    // Mirror of isGuest for non-render callbacks (auth listener, signOut).
    const guestRef = useRef(false);
    // isLoading releases only when both the session and the guest flag are known.
    const sessionResolved = useRef(false);
    const guestResolved = useRef(false);

    // Stable (ref + setState only) so the mount effect can list them as deps
    // without re-subscribing the auth listener.
    const settleLoading = useCallback(() => {
        if (sessionResolved.current && guestResolved.current) setIsLoading(false);
    }, []);

    const applyGuest = useCallback((value: boolean) => {
        guestRef.current = value;
        guestResolved.current = true;
        setIsGuest(value);
    }, []);

    // A session makes the guest flag moot; drop it in state and storage.
    const clearGuestForSession = useCallback(() => {
        const wasGuest = guestRef.current;
        applyGuest(false);
        if (wasGuest) void writeGuestMode(false);
    }, [applyGuest]);

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
        // TICKET-247: the durable guest flag. A session arriving first (or an
        // explicit enter/exit) wins over this slower read.
        readGuestMode().then((value) => {
            if (guestResolved.current) return;
            applyGuest(value);
            settleLoading();
        });

        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setImportPushOwner(session?.user?.id);
            setBackgroundImportOwner(session?.user?.id);
            searchLocalityStore.setActiveUser(session?.user?.id);
            searchCache.setActiveUser(session?.user?.id);
            placesScreenState.setActiveUser(session?.user?.id);
            setSession(session);
            setUser(session?.user ?? null);
            if (session) clearGuestForSession();
            sessionResolved.current = true;
            settleLoading();
            loadOnboardedAt(session?.user?.id);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                setImportPushOwner(session?.user?.id);
                setBackgroundImportOwner(session?.user?.id);
                searchLocalityStore.setActiveUser(session?.user?.id);
                searchCache.setActiveUser(session?.user?.id);
                placesScreenState.setActiveUser(session?.user?.id);
                setSession(session);
                setUser(session?.user ?? null);
                if (session) clearGuestForSession();
                sessionResolved.current = true;
                settleLoading();
                loadOnboardedAt(session?.user?.id);
            }
        );

        return () => {
            gateReadGeneration.current += 1;
            subscription.unsubscribe();
        };
        // loadOnboardedAt is a hoisted function declaration; the three guest
        // helpers are stable useCallbacks, listed to keep exhaustive-deps honest.
    }, [applyGuest, clearGuestForSession, settleLoading]);

    useEffect(() => watchImportPushRegistration(), []);

    const signOut = async () => {
        gateReadGeneration.current += 1;
        await Promise.all([
            unlinkImportPushDevice(user?.id),
            unlinkBackgroundImportIntake(user?.id),
        ]);
        await supabase.auth.signOut();
        searchLocalityStore.setActiveUser(null);
        searchCache.setActiveUser(null);
        placesScreenState.setActiveUser(null);
        // Clear all cached data to prevent user A seeing user B's data
        queryClient.removeQueries();
        setOnboardedAtState(undefined);
        // Signing out of an account lands on /auth, never in guest mode.
        applyGuest(false);
        await writeGuestMode(false);
    };

    const enterGuestMode = async () => {
        applyGuest(true);
        await writeGuestMode(true);
    };

    const exitGuestMode = async () => {
        applyGuest(false);
        await writeGuestMode(false);
    };

    return (
        <AuthContext.Provider
            value={{
                session,
                user,
                isLoading,
                isGuest,
                enterGuestMode,
                exitGuestMode,
                onboardedAt,
                setOnboardedAt,
                signOut,
            }}
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
