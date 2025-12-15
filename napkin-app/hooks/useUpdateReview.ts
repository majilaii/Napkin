import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

interface UpdateReviewParams {
    reviewId: string;
    userId: string;
    restaurantId: string; // foursquare_id for cache key
    updates: {
        rating?: number | null;
        content?: string | null;
        visited_at?: string;
    };
}

async function updateReview(
    reviewId: string,
    updates: UpdateReviewParams['updates']
): Promise<void> {
    const { error } = await supabase
        .from('reviews')
        .update({
            ...updates,
            updated_at: new Date().toISOString(),
        })
        .eq('id', reviewId);

    if (error) throw error;
}

export function useUpdateReview() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ reviewId, updates }: UpdateReviewParams) =>
            updateReview(reviewId, updates),
        onSuccess: (_data, variables) => {
            // Invalidate related caches
            queryClient.invalidateQueries({ queryKey: queryKeys.reviews.byUser(variables.userId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.reviews.existing(variables.userId, variables.restaurantId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.reviews.history(variables.userId, variables.restaurantId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.feed() });
        },
    });
}
