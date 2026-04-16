/**
 * Realtime subscription for Table Night state changes.
 * Listens to table_nights and table_night_participants via Supabase Realtime,
 * and invalidates React Query cache on changes.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

interface UseTableNightRealtimeOptions {
    nightId: string | null | undefined;
    onReveal?: () => void;
    onParticipantChange?: (payload: any) => void;
}

export function useTableNightRealtime({ nightId, onReveal, onParticipantChange }: UseTableNightRealtimeOptions) {
    const queryClient = useQueryClient();

    // Store callbacks in refs so the effect doesn't re-run when they change
    const onRevealRef = useRef(onReveal);
    onRevealRef.current = onReveal;
    const onParticipantChangeRef = useRef(onParticipantChange);
    onParticipantChangeRef.current = onParticipantChange;

    useEffect(() => {
        if (!nightId) return;

        const channel = supabase
            .channel(`table-night:${nightId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'table_night_participants',
                    filter: `table_night_id=eq.${nightId}`,
                },
                (payload) => {
                    onParticipantChangeRef.current?.(payload);
                    queryClient.invalidateQueries({
                        queryKey: queryKeys.tableNight.status(nightId),
                    });
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'table_nights',
                    filter: `id=eq.${nightId}`,
                },
                (payload) => {
                    if (payload.new.status === 'revealed') {
                        onRevealRef.current?.();
                    }
                    queryClient.invalidateQueries({
                        queryKey: queryKeys.tableNight.status(nightId),
                    });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [nightId, queryClient]);
}
