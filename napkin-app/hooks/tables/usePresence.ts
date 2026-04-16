/**
 * Supabase Presence hook for live round awareness.
 * Tracks who is on the round screen and what they are doing.
 * Manages channel lifecycle with AppState-aware subscribe/unsubscribe.
 */
import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { supabase } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface PresencePayload {
    userId: string;
    displayName: string;
    status: 'viewing' | 'rating' | 'uploading' | 'ready';
    lastActive: string;
}

interface UsePresenceOptions {
    nightId: string | null | undefined;
    userId: string | null | undefined;
    displayName: string | null | undefined;
}

export function usePresence({ nightId, userId, displayName }: UsePresenceOptions) {
    const [presenceState, setPresenceState] = useState<Record<string, PresencePayload>>({});
    const [isConnected, setIsConnected] = useState(false);

    const channelRef = useRef<RealtimeChannel | null>(null);
    const currentStatusRef = useRef<PresencePayload['status']>('viewing');
    const trackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inactivityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastTrackTimeRef = useRef(0);

    // Debounced track: max 1 call per 2 seconds
    const doTrack = useCallback((status: PresencePayload['status']) => {
        const channel = channelRef.current;
        if (!channel || !userId || !displayName) return;

        currentStatusRef.current = status;
        const now = Date.now();
        const elapsed = now - lastTrackTimeRef.current;

        const payload: PresencePayload = {
            userId,
            displayName,
            status,
            lastActive: new Date().toISOString(),
        };

        if (elapsed >= 2000) {
            lastTrackTimeRef.current = now;
            channel.track(payload);
        } else {
            // Schedule a deferred track
            if (trackTimeoutRef.current) clearTimeout(trackTimeoutRef.current);
            trackTimeoutRef.current = setTimeout(() => {
                lastTrackTimeRef.current = Date.now();
                channel.track(payload);
            }, 2000 - elapsed);
        }
    }, [userId, displayName]);

    const updateStatus = useCallback((status: PresencePayload['status']) => {
        // Clear any pending inactivity revert
        if (inactivityTimeoutRef.current) {
            clearTimeout(inactivityTimeoutRef.current);
            inactivityTimeoutRef.current = null;
        }

        doTrack(status);

        // For transient states, revert to 'viewing' after 5s of inactivity
        if (status === 'rating') {
            inactivityTimeoutRef.current = setTimeout(() => {
                if (currentStatusRef.current === 'rating') {
                    doTrack('viewing');
                }
            }, 5000);
        }
    }, [doTrack]);

    // Subscribe/unsubscribe logic
    const subscribe = useCallback(() => {
        if (!nightId || !userId || !displayName) return;
        if (channelRef.current) return; // already subscribed

        const channel = supabase.channel(`round-presence:${nightId}`, {
            config: { presence: { key: userId } },
        });

        channel
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState<PresencePayload>();
                const mapped: Record<string, PresencePayload> = {};
                for (const [key, presences] of Object.entries(state)) {
                    if (presences && presences.length > 0) {
                        mapped[key] = presences[0] as PresencePayload;
                    }
                }
                setPresenceState(mapped);
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    setIsConnected(true);
                    // Track initial presence
                    await channel.track({
                        userId,
                        displayName,
                        status: currentStatusRef.current,
                        lastActive: new Date().toISOString(),
                    } satisfies PresencePayload);
                }
            });

        channelRef.current = channel;
    }, [nightId, userId, displayName]);

    const unsubscribe = useCallback(() => {
        if (trackTimeoutRef.current) {
            clearTimeout(trackTimeoutRef.current);
            trackTimeoutRef.current = null;
        }
        if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
            channelRef.current = null;
            setIsConnected(false);
        }
    }, []);

    // AppState listener: unsubscribe on background, re-subscribe on foreground
    useEffect(() => {
        if (!nightId || !userId) return;

        const handleAppState = (nextState: AppStateStatus) => {
            if (nextState === 'active') {
                subscribe();
            } else {
                unsubscribe();
            }
        };

        const subscription = AppState.addEventListener('change', handleAppState);

        // Initial subscribe
        subscribe();

        return () => {
            subscription.remove();
            unsubscribe();
            if (inactivityTimeoutRef.current) {
                clearTimeout(inactivityTimeoutRef.current);
            }
        };
    }, [nightId, userId, subscribe, unsubscribe]);

    return useMemo(() => ({
        presenceState,
        updateStatus,
        isConnected,
    }), [presenceState, updateStatus, isConnected]);
}
