import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface SearchResult {
    id: string;
    name: string;
    formattedAddress: string;
    latitude?: number;
    longitude?: number;
}

async function searchRestaurants(query: string): Promise<SearchResult[]> {
    if (query.length < 3) return [];

    const { data, error } = await supabase.functions.invoke('places-search', {
        body: { query, limit: 5 },
    });

    if (error) throw error;
    return data?.data || [];
}

export function useRestaurantSearch(query: string) {
    return useQuery<SearchResult[], Error>({
        queryKey: queryKeys.restaurantSearch(query),
        queryFn: () => searchRestaurants(query),
        enabled: query.length >= 3,
        staleTime: 1000 * 60 * 10, // 10 minutes for search results
    });
}
