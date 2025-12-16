import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface UserPlace {
    id: string;
    user_id: string;
    name: string;
    address: string | null;
    icon: string;
    is_home: boolean;
    created_at: string;
}

/**
 * Fetch all saved places for a user
 */
async function fetchUserPlaces(userId: string): Promise<UserPlace[]> {
    const { data, error } = await supabase
        .from('user_places')
        .select('*')
        .eq('user_id', userId)
        .order('is_home', { ascending: false }) // Home first
        .order('name', { ascending: true });

    if (error) {
        console.error('Error fetching user places:', error);
        throw error;
    }

    return data || [];
}

/**
 * Hook to fetch user's saved places
 */
export function useUserPlaces(userId: string | null | undefined) {
    return useQuery<UserPlace[], Error>({
        queryKey: queryKeys.userPlaces(userId!),
        queryFn: () => fetchUserPlaces(userId!),
        enabled: !!userId,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}

/**
 * Create a new saved place
 */
interface CreatePlaceParams {
    userId: string;
    name: string;
    address?: string;
    icon?: string;
}

async function createUserPlace(params: CreatePlaceParams): Promise<UserPlace> {
    const { data, error } = await supabase
        .from('user_places')
        .insert({
            user_id: params.userId,
            name: params.name,
            address: params.address || null,
            icon: params.icon || '📍',
            is_home: false,
        })
        .select()
        .single();

    if (error) {
        console.error('Error creating user place:', error);
        throw error;
    }

    return data;
}

/**
 * Hook to create a new saved place
 */
export function useCreateUserPlace() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: createUserPlace,
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.userPlaces(variables.userId),
            });
        },
    });
}

/**
 * Delete a saved place
 */
async function deleteUserPlace(placeId: string): Promise<void> {
    const { error } = await supabase
        .from('user_places')
        .delete()
        .eq('id', placeId);

    if (error) throw error;
}

/**
 * Hook to delete a saved place
 */
export function useDeleteUserPlace() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ placeId, userId }: { placeId: string; userId: string }) =>
            deleteUserPlace(placeId),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.userPlaces(variables.userId),
            });
        },
    });
}
