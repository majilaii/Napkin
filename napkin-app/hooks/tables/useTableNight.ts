/**
 * Hooks for Table Night — real-time group rating sessions
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

// Types
export interface TableNight {
    id: string;
    table_id: string;
    restaurant_id: string;
    host_user_id: string;
    status: 'rating' | 'pre_reveal' | 'revealed' | 'closed';
    predictions_enabled: boolean;
    is_async: boolean;
    created_at: string;
    revealed_at: string | null;
}

export interface TableNightParticipant {
    user_id: string;
    rating: number | null;
    ready: boolean;
    notes: string | null;
    vibe_rating: number | null;
    flavor_rating: number | null;
    service_rating: number | null;
    value_rating: number | null;
    dish_description: string | null;
    profiles: {
        display_name: string;
        avatar_url: string | null;
    };
}

export interface RoundContext {
    nightId: string;
    participantCount: number;
    groupAverage: number | null;
}

export interface TableNightStatus extends TableNight {
    restaurants: {
        id: string;
        name: string;
        address: string | null;
        city: string | null;
        photo_url: string | null;
    } | null;
    participants: TableNightParticipant[];
}

// Helper to get auth headers
async function getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : undefined;
}

// Helper to invoke the edge function (POST)
async function invokeTableNight(body: Record<string, unknown>) {
    const headers = await getAuthHeaders();
    const { data, error } = await supabase.functions.invoke('table-night', {
        body,
        headers,
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data;
}

// ─── Queries ───

export function useActiveTableNight(tableId: string | null | undefined) {
    return useQuery<TableNight | null, Error>({
        queryKey: queryKeys.tableNight.active(tableId!),
        queryFn: async () => {
            const headers = await getAuthHeaders();
            const { data, error } = await supabase.functions.invoke(
                'table-night?action=active&table_id=' + tableId,
                { method: 'GET', headers }
            );
            if (error) throw error;
            return data?.data ?? null;
        },
        enabled: !!tableId,
        staleTime: 1000 * 60 * 5,
    });
}

export function useTableNightStatus(nightId: string | null | undefined) {
    return useQuery<TableNightStatus, Error>({
        queryKey: queryKeys.tableNight.status(nightId!),
        queryFn: async () => {
            const headers = await getAuthHeaders();
            const { data, error } = await supabase.functions.invoke(
                'table-night?action=status&table_night_id=' + nightId,
                { method: 'GET', headers }
            );
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            return data?.data;
        },
        enabled: !!nightId,
        staleTime: 1000 * 30, // 30 seconds — realtime supplements this
    });
}

// ─── Mutations ───

export function useStartTableNight() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { table_id: string; restaurant_id: string }) =>
            invokeTableNight({ action: 'start', ...input }),
        onSuccess: (data: TableNight) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.tableNight.active(data.table_id),
            });
        },
    });
}

export function useJoinTableNight() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { table_night_id: string }) =>
            invokeTableNight({ action: 'join', ...input }),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.tableNight.status(variables.table_night_id),
            });
        },
    });
}

export function useRateTableNight() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: {
            table_night_id: string;
            rating: number;
            notes?: string;
            dish_description?: string;
            photo_url?: string;
            vibe_rating?: number | null;
            flavor_rating?: number | null;
            service_rating?: number | null;
            value_rating?: number | null;
        }) => invokeTableNight({ action: 'rate', ...input }),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.tableNight.status(variables.table_night_id),
            });
        },
    });
}

export function useReadyTableNight() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { table_night_id: string }) =>
            invokeTableNight({ action: 'ready', ...input }),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.tableNight.status(variables.table_night_id),
            });
        },
    });
}

export function useRevealTableNight() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: { table_night_id: string }) =>
            invokeTableNight({ action: 'reveal', ...input }),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.tableNight.status(variables.table_night_id),
            });
        },
    });
}

/**
 * Lightweight query for entry page round context banner.
 * Only fetches participant count + group average — avoids pulling full night payload.
 * Shows banner without average if the night is not yet revealed.
 */
export function useRoundContext(tableNightId: string | null | undefined) {
    return useQuery<RoundContext | null, Error>({
        queryKey: queryKeys.tableNight.roundContext(tableNightId!),
        queryFn: async () => {
            // Fetch night status to check if revealed
            const { data: night, error: nightError } = await supabase
                .from('table_nights')
                .select('id, status')
                .eq('id', tableNightId!)
                .single();

            if (nightError || !night) return null;

            // Fetch participant count and ratings
            const { data: participants, error: partError } = await supabase
                .from('table_night_participants')
                .select('rating')
                .eq('table_night_id', tableNightId!);

            if (partError || !participants) return null;

            const participantCount = participants.length;

            // Only compute group average if the night is revealed
            let groupAverage: number | null = null;
            if (night.status === 'revealed') {
                const rated = participants.filter((p) => p.rating != null).map((p) => p.rating as number);
                if (rated.length > 0) {
                    groupAverage = rated.reduce((a, b) => a + b, 0) / rated.length;
                }
            }

            return { nightId: tableNightId!, participantCount, groupAverage };
        },
        enabled: !!tableNightId,
        staleTime: 1000 * 60 * 5,
    });
}
