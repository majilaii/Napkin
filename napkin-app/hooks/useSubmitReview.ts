import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

interface ReviewPayload {
    restaurant: {
        foursquare_id: string;
        name: string;
        location: { address: string };
        latitude: number;
        longitude: number;
    };
    rating: number;
    content?: string;
    value_profile?: {
        flavor: number;
        ambience: number;
        value: number;
        service: number;
    };
}

interface SubmitReviewParams {
    payload: ReviewPayload;
    userId: string;
    restaurantId: string;
}

async function submitReview(payload: ReviewPayload) {
    const { error } = await supabase.functions.invoke('review', {
        body: payload,
    });
    if (error) throw error;
}

export function useSubmitReview() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ payload }: SubmitReviewParams) => submitReview(payload),
        onSuccess: (_data, variables) => {
            // Invalidate multiple cache keys for proper UI updates
            queryClient.invalidateQueries({ queryKey: queryKeys.reviews.byUser(variables.userId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.feed() });
            queryClient.invalidateQueries({ queryKey: queryKeys.restaurant(variables.restaurantId) });
            // Invalidate existing review cache so modal shows updated state
            queryClient.invalidateQueries({ queryKey: queryKeys.reviews.existing(variables.userId, variables.restaurantId) });
        },
    });
}
