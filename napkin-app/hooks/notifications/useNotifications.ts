/**
 * useNotifications — Heirloom inbox feed.
 *
 * v1: returns hand-shaped sample data so the screen renders end-to-end against
 * the design. Wire to a real `notifications` edge function when the schema is
 * ready (see CLAUDE.md doctrine: profile + Tables + wishlist + restaurant
 * page is the live core loop).
 *
 * Event types map 1:1 to the canvas spec — only events that already exist as
 * primitives in the wireframes (logged meal, pinned place, Top 4 swap, Table
 * invite, claim-a-city nudge, reservation reminder).
 */
import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';

export type NotifBucket = 'today' | 'yesterday' | 'thisWeek' | 'earlier';

export type NotificationType =
    | 'friend_logged'
    | 'friend_pinned'
    | 'top_four_swap'
    | 'table_invite'
    | 'claim_city'
    | 'reservation_reminder';

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

export type Notification =
    | FriendLoggedNotification
    | FriendPinnedNotification
    | TopFourSwapNotification
    | TableInviteNotification
    | ClaimCityNotification
    | ReservationReminderNotification;

export interface NotificationsPage {
    notifications: Notification[];
    unreadCount: number;
}

const SAMPLE: Notification[] = [
    {
        id: 'n_001',
        type: 'friend_pinned',
        read: false,
        createdAt: relativeIso({ hours: 2 }),
        timeLabel: '2h ago · New York',
        actor: { id: 'u_julian', name: 'Julian Park' },
        restaurantName: 'Tatiana',
        wishlistLabel: 'NYC · May',
    },
    {
        id: 'n_002',
        type: 'friend_logged',
        read: false,
        createdAt: relativeIso({ hours: 4 }),
        timeLabel: "4h ago · somewhere you've been",
        actor: { id: 'u_clara', name: 'Clara Bellini' },
        restaurantName: 'St. John',
        quote: '"The marrow is still the marrow. ★★★★½"',
        youveBeen: true,
    },
    {
        id: 'n_003',
        type: 'top_four_swap',
        read: true,
        createdAt: relativeIso({ days: 1, hours: 2 }),
        timeLabel: 'Tuesday evening',
        actor: { id: 'u_maya', name: 'Maya Olsen' },
        addedName: 'St. John',
        removedName: 'Estela',
        tableName: 'Sunday Roast Club',
    },
    {
        id: 'n_004',
        type: 'table_invite',
        read: true,
        createdAt: relativeIso({ days: 1, hours: 6 }),
        timeLabel: 'Tuesday · 1:14pm',
        actor: { id: 'u_liam', name: 'Liam Reyes' },
        tableName: 'Two-Martini Lunch',
    },
    {
        id: 'n_005',
        type: 'claim_city',
        read: true,
        createdAt: relativeIso({ days: 3 }),
        timeLabel: 'Monday',
        cityName: 'New York',
        logCount: 12,
    },
    {
        id: 'n_006',
        type: 'friend_logged',
        read: true,
        createdAt: relativeIso({ days: 3, hours: 3 }),
        timeLabel: 'Monday evening · with Clara',
        actor: { id: 'u_julian', name: 'Julian Park' },
        restaurantName: 'Carbone',
        quote: '"Veal in lemon. ★★★★½"',
    },
    {
        id: 'n_007',
        type: 'reservation_reminder',
        read: true,
        createdAt: relativeIso({ days: 4 }),
        timeLabel: 'Sunday morning',
        restaurantName: 'Le Servan',
        dayLabel: 'Saturday',
    },
];

function relativeIso({
    hours = 0,
    days = 0,
}: {
    hours?: number;
    days?: number;
}) {
    const ms = (days * 24 + hours) * 60 * 60 * 1000;
    return new Date(Date.now() - ms).toISOString();
}

export function useNotifications(userId: string | null | undefined) {
    return useQuery<NotificationsPage>({
        queryKey: userId ? queryKeys.notifications.all(userId) : ['notifications', 'no-user'],
        enabled: !!userId,
        staleTime: 1000 * 30,
        queryFn: async () => {
            // TODO: replace with `callEdgeFn('notifications', { method: 'GET', action: 'inbox' })`
            // once the edge function lands. For now, return designed sample data so the
            // surface renders against the spec.
            return {
                notifications: SAMPLE,
                unreadCount: SAMPLE.filter((n) => !n.read).length,
            };
        },
    });
}

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
