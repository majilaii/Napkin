/**
 * Realtime subscription for post interactions (reactions + comments).
 * Subscribes to a per-post channel and invalidates the TanStack Query cache
 * on any change. Cleanly unsubscribes on unmount.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { TargetType } from './usePostInteractions';

interface UsePostInteractionsRealtimeOptions {
    targetType: TargetType | null | undefined;
    targetId: string | null | undefined;
}

export function usePostInteractionsRealtime({
    targetType,
    targetId,
}: UsePostInteractionsRealtimeOptions) {
    const queryClient = useQueryClient();

    useEffect(() => {
        if (!targetType || !targetId) return;

        const channelName = `post-interactions:${targetType}:${targetId}`;
        const queryKey = queryKeys.postInteractions.all(targetType, targetId);

        // Supabase Realtime postgres_changes only accepts ONE column filter per
        // listener, so we filter by target_id server-side and narrow to the
        // matching target_type in the handler. Without this, a table_night and
        // entry sharing a UUID (astronomically unlikely) would cross-invalidate.
        const invalidateIfMatch = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
            const row = payload.new ?? payload.old ?? {};
            if (row.target_type && row.target_type !== targetType) return;
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
    }, [targetType, targetId, queryClient]);
}
