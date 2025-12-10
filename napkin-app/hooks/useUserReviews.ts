import { useQuery } from '@tanstack/react-query';
import { getUserReviews, Review } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

export function useUserReviews(userId: string | null | undefined) {
    return useQuery<Review[], Error>({
        queryKey: queryKeys.reviews.byUser(userId!),
        queryFn: () => getUserReviews(userId!),
        enabled: !!userId, // Only fetch when userId is available
    });
}
