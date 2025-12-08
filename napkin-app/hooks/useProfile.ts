import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface UserProfile {
    user_id: string;
    display_name: string | null;
    flavor: number;
    ambience: number;
    value: number;
    service: number;
}

async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
    const { data, error } = await supabase.functions.invoke('user-profile', {
        method: 'GET',
    });

    if (error) throw error;
    return data?.data ?? null;
}

export function useProfile(userId: string | null | undefined) {
    return useQuery<UserProfile | null, Error>({
        queryKey: queryKeys.profile(userId!),
        queryFn: () => fetchUserProfile(userId!),
        enabled: !!userId,
    });
}
