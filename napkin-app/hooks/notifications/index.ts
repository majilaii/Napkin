/**
 * Barrel export for Notifications hooks.
 */
export {
    useNotifications,
    useUnreadCount,
    bucketFor,
    bucketLabel,
    flattenPages,
    type NotifBucket,
    type Notification,
    type NotificationType,
    type InboxExtras,
    type InboxPage,
    type FriendLoggedNotification,
    type FriendPinnedNotification,
    type TopFourSwapNotification,
    type TableInviteNotification,
    type ClaimCityNotification,
    type ReservationReminderNotification,
} from './useNotifications';

export { useMarkNotificationRead } from './useMarkNotificationRead';
export { useMarkAllNotificationsRead } from './useMarkAllNotificationsRead';
