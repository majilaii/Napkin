/**
 * Realtime subscription for post interactions (reactions + comments).
 * Subscribes to a per-post-per-scope channel and invalidates the TanStack Query cache
 * on any change. Cleanly unsubscribes on unmount.
 *
 * TICKET-021: scope is required. Channel name includes scope to avoid
 * cross-scope invalidations between table and public subscribers on the same entry.
 * Client-side filter on payload.scope provides belt-and-suspenders isolation.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { TargetType, Scope } from './usePostInteractions';

interface UsePostInteractionsRealtimeOptions {
    targetType: TargetType | null | undefined;
    targetId: string | null | undefined;
    scope?: Scope;
}

export function usePostInteractionsRealtime({
    targetType,
    targetId,
    scope = 'table',
}: UsePostInteractionsRealtimeOptions) {
    const queryClient = useQueryClient();

    /**
     * Per-instance channel identity — fixes an uncaught runtime error.
     *
     * `supabase.channel(name)` RETURNS AN EXISTING channel when one is already
     * registered under that name, and calling `.on()` on a channel that has
     * already been `.subscribe()`d THROWS:
     *   "cannot add `postgres_changes` callbacks for realtime:… after `subscribe()`"
     *
     * The old name was derived purely from (targetType, targetId, scope), so any
     * second registration for the same post collided. `removeChannel()` is async
     * — it unsubscribes, THEN drops the registry entry — so navigating away and
     * straight back reliably re-entered this effect while the previous channel
     * was still registered, took the stale subscribed instance, and threw. It
     * reproduced on every open of a review detail.
     *
     * A nonce guarantees a fresh channel per hook instance. Cost: two mounted
     * consumers of the same post now hold two channels instead of sharing one —
     * correct, because the "sharing" was never real; the second consumer just
     * crashed. Cleanup still removes exactly the channel this instance made.
     */
    const instanceIdRef = useRef<string | null>(null);
    if (instanceIdRef.current === null) {
        instanceIdRef.current = Math.random().toString(36).slice(2, 10);
    }
    const instanceId = instanceIdRef.current;

    useEffect(() => {
        if (!targetType || !targetId) return;

        // TICKET-036 P2-11: debounce subscribe by 150ms so rapid back-and-forth
        // navigation between two entry-details doesn't churn through 20
        // connect/disconnect cycles per second and trip Supabase channel limits.
        let channel: ReturnType<typeof supabase.channel> | null = null;
        let cancelled = false;

        const timer = setTimeout(() => {
            if (cancelled) return;

            // Scope keeps table and public subscribers apart; the instance nonce
            // keeps this mount from colliding with a not-yet-removed channel.
            const channelName = `post-interactions:${targetType}:${targetId}:${scope}:${instanceId}`;
            const queryKey = queryKeys.postInteractions.all(targetType, targetId, scope);

            // Supabase Realtime postgres_changes only accepts ONE column filter per
            // listener, so we filter by target_id server-side and narrow to the
            // matching target_type AND scope in the handler. Two independent gates:
            // RLS-aware realtime drops deltas the caller can't SELECT (first gate),
            // and this client handler checks scope (second gate).
            const invalidateIfMatch = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
                const row = payload.new ?? payload.old ?? {};
                if (row.target_type && row.target_type !== targetType) return;
                if (row.scope && row.scope !== scope) return;
                queryClient.invalidateQueries({ queryKey });
            };

            channel = supabase
                .channel(channelName)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'post_reactions',
                        filter: `target_id=eq.${targetId}`,
                    },
                    invalidateIfMatch
                )
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'post_comments',
                        filter: `target_id=eq.${targetId}`,
                    },
                    invalidateIfMatch
                )
                .subscribe();
        }, 150);

        return () => {
            cancelled = true;
            clearTimeout(timer);
            if (channel) supabase.removeChannel(channel);
        };
    }, [targetType, targetId, scope, queryClient, instanceId]);
}
