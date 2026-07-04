/**
 * useFriendsFeed — cursor-paginated friends-only reviews feed (TICKET-098).
 *
 * Rows are public-eligible entries authored by the viewer's follow set
 * (asymmetric follows; self excluded; blocks excluded), reverse-chron.
 * Chronology only — no ranking.
 *
 * Engagement fields are PUBLIC-scope counters, but the field NAMES match the
 * legacy FeedEntry (reaction_count / comment_count / top_emojis / my_reactions)
 * on purpose: the shared optimistic walkers in usePostInteractions and
 * useUpdateEntry/useDeleteEntry patch these names across feed pages
 * [ARCH-REVIEW-2].
 *
 * Wire shape (per page): canonical Page<FriendFeedRow> envelope.
 */
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useCursorPagedQuery, flattenPages, type Page } from '@/lib/pagination';
import type { EmojiCount } from '@/hooks/posts/usePostInteractions';

export interface FriendFeedRow {
    id: string;
    user_id: string;
    restaurant_id: string | null;
    rating: number | null;
    content: string | null;
    visited_at: string | null;
    created_at: string;
    sort_date: string;
    photos: string[];
    photo_count: number;
    /** PUBLIC-scope reaction count (entries.public_reaction_count). */
    reaction_count: number;
    /** PUBLIC-scope reply count (entries.public_reply_count). */
    comment_count: number;
    /** PUBLIC-scope top emojis. */
    top_emojis: EmojiCount[];
    /** Viewer's own public-scope reactions on this entry. */
    my_reactions: string[];
    restaurant: { id: string; name: string; photo_url: string | null } | null;
    author: {
        user_id: string;
        username: string | null;
        display_name: string;
        avatar_url: string | null;
    };
}

async function fetchFriendsFeedPage(cursor: string | null): Promise<Page<FriendFeedRow>> {
    return callEdgeFn<Page<FriendFeedRow>>('feed-friends', {
        body: { cursor, limit: 30 },
    });
}

export function useFriendsFeed(userId: string | undefined) {
    return useCursorPagedQuery<FriendFeedRow>({
        queryKey: userId ? queryKeys.feed.friends(userId) : ['feed', 'friends', 'anon'],
        fetchPage: (cursor) => fetchFriendsFeedPage(cursor),
        enabled: !!userId,
        staleTime: 1000 * 60 * 2,
    });
}

/** Flatten all pages of friend-feed rows. */
export function flattenFriendsFeed(
    data: ReturnType<typeof useFriendsFeed>['data'],
): FriendFeedRow[] {
    return flattenPages(data);
}
