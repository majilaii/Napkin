/** Viewer + followed public activity. Namespaced non-entry IDs keep shared entry cache walkers safe. */
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useCursorPagedQuery, flattenPages, type Page } from '@/lib/pagination';
import type { EmojiCount } from '@/hooks/posts/usePostInteractions';

export interface FriendFeedRow {
    kind?: 'entry';
    activity_key?: string;
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

interface ActivityBase {
    id: string;
    activity_key: string;
    user_id: string;
    sort_date: string;
    created_at: string;
    author: FriendFeedRow['author'];
}
export interface PinFeedRow extends ActivityBase {
    kind: 'pin';
    restaurant_id: string;
    restaurant: NonNullable<FriendFeedRow['restaurant']>;
}
export interface ListFeedRow extends ActivityBase {
    kind: 'list';
    list_id: string;
    title: string;
    emoji: string | null;
    updated_at: string;
    action: 'created' | 'updated';
}
export type FriendsActivityRow = FriendFeedRow | PinFeedRow | ListFeedRow;

async function fetchFriendsFeedPage(cursor: string | null): Promise<Page<FriendsActivityRow>> {
    return callEdgeFn<Page<FriendsActivityRow>>('feed-friends', {
        body: { cursor, limit: 30, include_activity: true },
    });
}

export function useFriendsFeed(userId: string | undefined) {
    return useCursorPagedQuery<FriendsActivityRow>({
        queryKey: userId ? queryKeys.feed.activity(userId) : ['feed', 'friends', 'anon', 'activity'],
        fetchPage: (cursor) => fetchFriendsFeedPage(cursor),
        enabled: !!userId,
        staleTime: 1000 * 60 * 2,
    });
}

export function flattenFriendsFeed(data: ReturnType<typeof useFriendsFeed>['data']): FriendsActivityRow[] {
    return flattenPages(data);
}
