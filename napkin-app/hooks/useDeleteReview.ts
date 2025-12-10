import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

interface DeleteReviewParams {
    reviewId: string;
    userId: string;
    restaurantId: string; // foursquare_id for cache key
}

async function deleteReview(reviewId: string): Promise<void> {
    const { error } = await supabase
        .from('reviews')
        .delete()
        .eq('id', reviewId);

    if (error) throw error;
}

export function useDeleteReview() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ reviewId }: DeleteReviewParams) => deleteReview(reviewId),
        onSuccess: (_data, variables) => {
            // Invalidate related caches
            queryClient.invalidateQueries({ queryKey: queryKeys.reviews.byUser(variables.userId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.reviews.existing(variables.userId, variables.restaurantId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.restaurantStatus(variables.userId, variables.restaurantId) });
        },
    });
}
