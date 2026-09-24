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
    /**
     * True when the onboarding-gate read exhausted its retries without an
     * answer. The gate stays closed (fail-closed); the launch screen offers
     * a retry instead of holding a silent spinner forever.
     */
    onboardingGateUnresolved: boolean;
    /** Re-read the onboarding gate for the signed-in user. */
    retryOnboardingGate: () => void;
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
    const [onboardingGateUnresolved, setOnboardingGateUnresolved] = useState(false);
    const gateReadGeneration = useRef(0);
    const gateUserId = useRef<string | null>(null);
    // Where the gate stands for gateUserId, readable from auth callbacks.
    const gateStatus = useRef<'idle' | 'loading' | 'resolved' | 'unresolved'>('idle');
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
        gateStatus.current = 'resolved';
        setOnboardingGateUnresolved(false);
        setOnboardedAtState(value);
    }, []);

    // Fetch the onboarding gate column for a user. Resets to `undefined` first so
    // the gate waits rather than acting on the previous user's value. Missing row
    // or error → remain unresolved/checking (never fail open past onboarding).
    const loadOnboardedAt = useCallback(async (userId: string | null | undefined) => {
        const generation = ++gateReadGeneration.current;
        gateUserId.current = userId ?? null;
        gateStatus.current = userId ? 'loading' : 'idle';
        setOnboardingGateUnresolved(false);
        if (!userId) {
            setOnboardedAtState(undefined);
            return;
        }
        setOnboardedAtState(undefined);
        const result = await readOnboardingGateWithRetry(userId);
        if (gateReadGeneration.current !== generation) return;
        if (result.status === 'resolved') {
            gateStatus.current = 'resolved';
            setOnboardedAtState(result.value);
        } else {
            gateStatus.current = 'unresolved';
            setOnboardingGateUnresolved(true);
        }
    }, []);

    /**
     * Auth events for the person the gate already describes (a token refresh,
     * a user-metadata update, the initial-session echo) must not reset it:
     * resetting unmounts every signed-in surface, losing navigation and any
     * draft, and replays the cover. Re-read only for a different identity, or
     * when the last read never got an answer.
     */
    const syncOnboardingGate = useCallback((userId: string | null | undefined) => {
        const sameIdentity = (userId ?? null) === gateUserId.current;
        if (sameIdentity && (gateStatus.current === 'resolved' || gateStatus.current === 'loading')) {
            return;
        }
        void loadOnboardedAt(userId);
    }, [loadOnboardedAt]);

    const retryOnboardingGate = useCallback(() => {
        if (gateUserId.current) void loadOnboardedAt(gateUserId.current);
    }, [loadOnboardedAt]);

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
            syncOnboardingGate(session?.user?.id);
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
                syncOnboardingGate(session?.user?.id);
            }
        );

        return () => {
            gateReadGeneration.current += 1;
            // The bump discards any in-flight read; without this a remount
            // would see 'loading' for the same identity and never re-read.
            gateStatus.current = 'idle';
            subscription.unsubscribe();
        };
        // The three guest helpers are stable useCallbacks, listed to keep
        // exhaustive-deps honest.
    }, [syncOnboardingGate, applyGuest, clearGuestForSession, settleLoading]);

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
        gateUserId.current = null;
        gateStatus.current = 'idle';
        setOnboardingGateUnresolved(false);
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
                onboardingGateUnresolved,
                retryOnboardingGate,
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
