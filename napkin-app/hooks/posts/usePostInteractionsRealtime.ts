/**
 * Realtime subscription for post interactions (reactions + comments).
 * Subscribes to a per-post-per-scope channel and invalidates the TanStack Query cache
 * on any change. Cleanly unsubscribes on unmount.
 *
 * TICKET-021: scope is required. Channel name includes scope to avoid
 * cross-scope invalidations between table and public subscribers on the same entry.
 * Client-side filter on payload.scope provides belt-and-suspenders isolation.
 */
import { useEffect } from 'react';
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

    useEffect(() => {
        if (!targetType || !targetId) return;

        // Channel name includes scope so table and public subscribers don't share a channel
        const channelName = `post-interactions:${targetType}:${targetId}:${scope}`;
        const queryKey = queryKeys.postInteractions.all(targetType, targetId, scope);

        // Supabase Realtime postgres_changes only accepts ONE column filter per
        // listener, so we filter by target_id server-side and narrow to the
        // matching target_type AND scope in the handler. Two independent gates:
        // RLS-aware realtime drops deltas the caller can't SELECT (first gate),
        // and this client handler checks scope (second gate).
        const invalidateIfMatch = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
            const row = payload.new ?? payload.old ?? {};
            // Narrow by target_type
            if (row.target_type && row.target_type !== targetType) return;
            // Belt-and-suspenders: narrow by scope to prevent cross-scope invalidation
            if (row.scope && row.scope !== scope) return;
            queryClient.invalidateQueries({ queryKey });
        };

        const channel = supabase
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

        return () => {
            supabase.removeChannel(channel);
        };
    }, [targetType, targetId, scope, queryClient]);
}
