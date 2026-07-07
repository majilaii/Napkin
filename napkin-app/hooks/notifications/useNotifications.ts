/**
 * useNotifications — Heirloom inbox feed.
 *
 * Uses useCursorPagedQuery against the `notifications` edge function (inbox action).
 * The `unread_count` field rides on the first page of the paginated envelope;
 * read it via `data?.pages?.[0]?.unread_count ?? 0`.
 *
 * Event types map 1:1 to the canvas spec:
 *   friend_logged | friend_pinned | top_four_swap | table_invite | claim_city | reservation_reminder
 */
import { queryKeys } from '@/lib/queryKeys';
import { useCursorPagedQuery, flattenPages, type Page } from '@/lib/pagination';
import { callEdgeFn } from '@/lib/edgeInvoke';

export type NotifBucket = 'today' | 'yesterday' | 'thisWeek' | 'earlier';

export type NotificationType =
    | 'friend_logged'
    | 'friend_pinned'
    | 'top_four_swap'
    | 'table_invite'
    | 'claim_city'
    | 'reservation_reminder'
    | 'import_done';

interface BaseNotification {
    id: string;
    type: NotificationType;
    /** ISO timestamp — used to bucket into Today/Yesterday/This week/Earlier. */
    createdAt: string;
    /** When false, row renders with the terracotta spine + tinted wash. */
    read: boolean;
    /** Pre-rendered relative time string ("Tuesday evening" preferred over "2h ago"). */
    timeLabel: string;
}

export interface FriendLoggedNotification extends BaseNotification {
    type: 'friend_logged';
    actor: { id: string; name: string; avatarUrl?: string | null };
    restaurantName: string;
    restaurantId?: string;
    photoUrl?: string | null;
    /** The friend's quoted note + stars, displayed as italic-serif body. */
    quote?: string;
    /** Set when the viewer has been to the same restaurant. */
    youveBeen?: boolean;
}

export interface FriendPinnedNotification extends BaseNotification {
    type: 'friend_pinned';
    actor: { id: string; name: string; avatarUrl?: string | null };
    restaurantName: string;
    restaurantId?: string;
    /** Shared wishlist label, e.g. "NYC · May" or "Sunday Roast Club". */
    wishlistLabel: string;
    photoUrl?: string | null;
}

export interface TopFourSwapNotification extends BaseNotification {
    type: 'top_four_swap';
    actor: { id: string; name: string; avatarUrl?: string | null };
    /** Restaurant added to the Top 4. */
    addedName: string;
    /** Restaurant removed from the Top 4. */
    removedName: string;
    tableName: string;
    photoUrl?: string | null;
}

export interface TableInviteNotification extends BaseNotification {
    type: 'table_invite';
    actor: { id: string; name: string; avatarUrl?: string | null };
    tableName: string;
    tableId?: string;
}

export interface ClaimCityNotification extends BaseNotification {
    type: 'claim_city';
    cityName: string;
    /** Number of places the user has logged in that city. */
    logCount: number;
}

export interface ReservationReminderNotification extends BaseNotification {
    type: 'reservation_reminder';
    restaurantName: string;
    restaurantId?: string;
    /** Pre-formatted day of the meal, e.g. "Saturday". */
    dayLabel: string;
}

/**
 * TICKET-123: self-directed import lifecycle row. No actor — "your import
 * finished". `outcome` drives the copy; `jobId` (present for 'saved') deep-links
 * the tap to /imports/[jobId], review/failed route to /import-progress.
 */
export interface ImportDoneNotification extends BaseNotification {
    type: 'import_done';
    count: number;
    outcome: 'saved' | 'review' | 'failed';
    jobId?: string;
}

export type Notification =
    | FriendLoggedNotification
    | FriendPinnedNotification
    | TopFourSwapNotification
    | TableInviteNotification
    | ClaimCityNotification
    | ReservationReminderNotification
    | ImportDoneNotification;

/** Extra top-level field on the inbox page envelope (first page only; subsequent pages have null). */
export type InboxExtras = { unread_count: number | null };
/** Full page shape for the inbox — Page<Notification> extended with unread_count. */
export type InboxPage = Page<Notification> & InboxExtras;

async function fetchInboxPage(
    cursor: string | null,
    _token: string | null,
): Promise<InboxPage> {
    return callEdgeFn<InboxPage>('notifications', {
        body: { action: 'inbox', cursor },
    });
}

export function useNotifications(userId: string | null | undefined) {
    return useCursorPagedQuery<Notification, InboxExtras>({
        queryKey: queryKeys.notifications.all(userId ?? ''),
        fetchPage: fetchInboxPage,
        enabled: !!userId,
        staleTime: 1000 * 30,
    });
}

/**
 * Selector helper: reads unread_count from the first cached inbox page.
 * Used by NotifBell (on ProfileHeader) and the BottomNavBar dot.
 * Avoids a separate query key — the unread count is always in sync with the inbox.
 */
export function useUnreadCount(userId: string | null | undefined): number {
    const { data } = useNotifications(userId);
    return data?.pages?.[0]?.unread_count ?? 0;
}

/** Re-export for callers that import flattenPages from the notifications barrel. */
export { flattenPages };

export function bucketFor(createdAtIso: string): NotifBucket {
    const created = new Date(createdAtIso);
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfToday.getDate() - 1);
    const startOfThisWeek = new Date(startOfToday);
    startOfThisWeek.setDate(startOfToday.getDate() - 6);

    if (created >= startOfToday) return 'today';
    if (created >= startOfYesterday) return 'yesterday';
    if (created >= startOfThisWeek) return 'thisWeek';
    return 'earlier';
}

export function bucketLabel(bucket: NotifBucket): string {
    switch (bucket) {
        case 'today':
            return 'Today';
        case 'yesterday':
            return 'Yesterday';
        case 'thisWeek':
            return 'This week';
        case 'earlier':
            return 'Earlier';
    }
}
